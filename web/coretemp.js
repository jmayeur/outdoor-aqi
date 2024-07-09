async function getCoreTempData(src) {
    const response = await fetch(`${src}/getcoretemp`)
    const result = await response.json();
    return result;
};



async function displayCoreTemp() {
    const coreTemp = await getCoreTempData('http://192.168.119.137');
    document.getElementById('coretemp').innerHTML = coreTemp.core_temp;
}

displayCoreTemp();
setInterval(displayCoreTemp, 5000);