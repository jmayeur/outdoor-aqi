async function getCoreTempData(src) {
    const response = await fetch(`${src}/getcoretemp`)
    const result = await response.json();
    return result;
};



async function displayCoreTemp() {
    const coreTemp = await getCoreTempData('http://192.168.119.137');
    const color = tempToColor(parseFloat(coreTemp.core_temp.replace('\'', '')), -10, 65);
    const el = document.getElementById('coretemp');
    el.style.color = `rgb(${color.r}, ${color.g}, ${color.b})`;
    el.innerHTML = (coreTemp.core_temp || '').replace('\'', '°');
}
displayCoreTemp();
setInterval(displayCoreTemp, 5000);

