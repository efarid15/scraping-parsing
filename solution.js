const axios = require('axios');
const {URL} = require('url');
const $ = require('cheerio');
const fs = require('fs')
const Nm = require('nightmare');

axios.defaults.timeout = 25000;
const BASE_URL = 'https://www.bankmega.com/promolainnya.php';
const WAITING_TIME = 2500;
let startTime = process.hrtime();

function parseHrtimeToSeconds(hrtime) {
    seconds = (hrtime[0]+ hrtime[1] / Math.pow(10,9)).toFixed(3);
    return seconds;
}

async function gatheringData() {
    console.log("Gathering categories data..");
    let subcat = await getSubcat();

    console.log("Gathering promo data..");
    let promoPackage = await getPromoPackage(subcat);

    console.log("Gathering detail promo..");
    let promoDetails = await getPromoDetails(promoPackage);

    console.log("Prepare json files..");
    let result = {};

    subcat.forEach(categoryPromo => {
        result[categoryPromo.title] = [];
    });

    promoDetails.forEach(promo => {
        let categoryName = promo.categoryPromo.title;
        delete promo.categoryPromo;
        result[categoryName].push(promo);
    });

    return result;
}

async function getSubcat() {
    return axios.get(BASE_URL).then((response) => {
        if (response && response.status == 200 && response.data) {
            return $('#subcatpromo img', response.data).map((i, el) => el.attribs).get();
        } else {
            Promise.reject(new Error(`Failed get response/data from ${BASE_URL}`));
        }
    })
}

async function getCategoryPromo(categoryPromo) {
    console.log(`=== Gathering category ${categoryPromo.title}`);
    const nm = new Nm({show: false});
    await nm
        .goto(BASE_URL)
        .exists('#subcatpromo')
        .click('#' + categoryPromo.id)
        .wait(WAITING_TIME);

    let promolist = [];
    let currentPage = 0, lastPage = 0;
    
    do {
        singlePagePromo = await getSinglePage(nm, categoryPromo)
        promolist.push(...singlePagePromo);
        info = await getPageNumber(nm);

        if (info) {
            [currentPage, lastPage] = info.split(' ').map((token)=>parseInt(token))
                .filter((token) => !isNaN(token));
        } else {
            currentPage = 0;
            lastPage = 0;
        }
        if (currentPage < lastPage) {
            await nm
                .evaluate(() => {
                    let pagePromo = document.querySelectorAll('.page_promo_lain');
                    pagePromo[pagePromo.length-1].click();
                }).wait(WAITING_TIME);
        }
    } while (currentPage < lastPage);
    let elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime));
    console.log(`  Done ${categoryPromo.title} in ${elapsedSeconds} sec`);
    return promolist;
}


async function getPromoPackage(subcat) {
    return Promise.all(subcat.map(getCategoryPromo))
        .then((promoPackage) => [].concat.apply([], promoPackage));
}

async function getSinglePage(nm, categoryPromo) {
    return nm
        .evaluate(() => document.querySelector('#promolain').innerHTML)
        .then((html) => $('img', html).map((i, el) => {
            let promo = {categoryPromo: categoryPromo};
            if (el) {
                if (el.attribs.title) 
                    promo.title = el.attribs.title;
                if (el.parent && el.parent.attribs.href)
                    promo.url = new URL(el.parent.attribs.href, BASE_URL).toString();
                if (el.attribs.src) 
                    promo.image_url = new URL(el.attribs.src, BASE_URL).toString();
            }
            return promo;
        }).get());
}

async function getPageNumber(nm) {
    return nm
        .evaluate(() => { 
            let paging1 = document.querySelector('#paging1');
            if (paging1) {
                return paging1.getAttribute('title');
            } else {
                return null;
            }
        });
}

async function getPromoDetails(promolist) {
    return Promise.all(promolist.map(getPromoDetail));
}

async function getPromoDetail(promo) {
    console.log(`=== Gathering detail url : ${promo.url}`);
    return axios.get(promo.url)
        .then((response) => {
            if (response && response.status == 200 && response.data) {
                promo = Object.assign({}, promo, scanDetailPromo(response));   
                let elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime));
                console.log(`Done in ${elapsedSeconds} sec`);            
            } else {
                console.log(` Warning: failed get response/data ${promo.url}`);
            }
            return promo;
        }).catch((err) => {
            console.log(` Failed get data from url : ${promo.url}  (${err})`);
            promo.error = err.message;
            return promo;
        });
}

function scanDetailPromo(response) {
    detailPromo = {}
    let html = $('#contentpromolain2', response.data).html();
    let areaPromo = $('.area', html).text().replace('Area Promo : ', '');
    let periodPromo = $('.periode', html).text().replace(/\t|\n/g, '').replace('Periode Promo : ', '');
    let descriptionImageUrl = $('.keteranganinside img', html).attr('src');

    if (areaPromo) detailPromo.area_promo = areaPromo;
    if (periodPromo) {
        let [startPeriod, endPeriod] = periodPromo.split(' - ');
        if (startPeriod) detailPromo.start_promo = periodStart(startPeriod);
        if (endPeriod) detailPromo.end_promo = periodEnd(endPeriod);
    }
    if (descriptionImageUrl) {
        detailPromo.desc_image = new URL(descriptionImageUrl, BASE_URL).toString();
    }
    return detailPromo;
}

function periodStart(period) {
    return {date: period};
}

function periodEnd(period) {
    return {date: period};
}

gatheringData().then((promolist) => {
    const jsonfile = 'solution.json';
    console.log(`Writing file ${jsonfile}..`);
    fs.writeFileSync(jsonfile, JSON.stringify(promolist, null, 4));
    let elapsedSeconds = parseHrtimeToSeconds(process.hrtime(startTime));
    console.log(`All done in ${elapsedSeconds} sec`);
}).catch((err) => {
    console.log('Failed error:', err);
}).then(() => {
    process.exit();
});