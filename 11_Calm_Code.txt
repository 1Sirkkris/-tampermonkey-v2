// ==UserScript==
// @name       MAIN v1.3.1 Calm Code
// @version      1.3.1
// @description Adds Calm Code Buttons into the FCLM Labor Tracking Kiosk for AFE. Initial code from jeickels@, dkingamz@ & salloumr@
// @author      @blelliot and @nichpres edit by @phanmpet
// @match      https://fcmenu-iad-regionalized.corp.amazon.com/*/laborTrackingKiosk*
// @match      http://fcmenu-iad-regionalized.corp.amazon.com/*/laborTrackingKiosk*
// @match      https://fcmenu-nrt-regionalized.corp.amazon.com/*/laborTrackingKiosk*
// @match      http://fcmenu-nrt-regionalized.corp.amazon.com/*/laborTrackingKiosk*
// @match      https://fcmenu-nrt-regionalized.corp.amazon.com/*/calmCode*
// @match      http://fcmenu-nrt-regionalized.corp.amazon.com/*/calmCode*
// @exclude      http://fcmenu-iad-regionalized.corp.amazon.com/do/laborTrackingKiosk*
// @exclude      https://fcmenu-iad-regionalized.corp.amazon.com/do/laborTrackingKiosk*
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Calm_Code.user.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Calm_Code.user.js
// ==/UserScript==
(() => {
'use strict';
const CALM_VERSION = '1.3.1';
const CALM_GUARD_ATTR = 'data-bwu2-calm-code';
if (document.documentElement.hasAttribute(CALM_GUARD_ATTR)) return;
document.documentElement.setAttribute(CALM_GUARD_ATTR, CALM_VERSION);

var css = document.createElement("style");
css.innerHTML += `
* {
    box-sizing: border-box;
}
#body {
    display: flex;
    flex-flow: row nowrap;
    align-content: space-around;
    justify-content: space-around;
}
#body > .login {
    margin: 0;
    width: 25%;
    max-width: 300px;
}
#body > #toolbox {
    width: 75%;
    flex-grow: 2;
    font-size: 150%;
    display: flex;
    flex-flow: column nowrap;
    align-content: space-around;
    justify-content: space-around;
}
#body > #toolbox > .row {
    margin-bottom: 8px;
}
#body > #toolbox > .row > h1 {
    border-bottom: 2px inset;
    margin-bottom: 4px;
    padding: 0 8px;
    background: rgba(173,216,230,0.5);
}
#body > #toolbox > .row > .roles {
    display: flex;
    flex-flow: row nowrap;
    align-content: space-between;
    justify-content: space-between;
    padding: 0 8px;
    max-width: 1000px;
}
#body > #toolbox > .row > .roles > button {
    display: table-row;
    max-width: 25%;
    background: #FFFFFF;
    border-radius: 13px;
    border:2px solid black;
    color: #000000;
    font-size: 20px;
    padding: 4px 12px;
    margin: 0 8px;
}

#body > #toolbox > .row > .roles > button:hover {
    background: #3cb0fd;
}
`;
document.querySelector("head").appendChild(css);
function movebox() {
    let waitForIt;
    if (waitForIt = document.querySelector('#body > .login')) {
        waitForIt.style = '';
    } else {
        setTimeout(movebox, 500);
    }
}
movebox();
var codes = [
    {
        title: 'ISS',
        roles: [
            {name: 'IBPS', code: 'IBPS'},
            {name: 'RECON', code: 'RECON'},
            {name: 'PSBL', code: 'PSBL'},
            {name: 'ICVR', code: 'ICVR'},
            {name: 'LPSWEEP', code: 'LPSWEEP'},
        ]
    },
    {
        title: 'Damages',
        roles: [
            {name: 'ICQADMP', code: 'ICQADMP'},
            {name: 'DAMAGES', code: 'DAMAGES'},
        ]
    },
     {
        title: 'Etc',
        roles: [
            {name: 'HRACCOM', code: 'HRACCOM'},
            {name: 'IB Lead/PA', code: 'LRSR'},
            {name: 'Non-sort', code: 'FCPRJ'},
            {name: 'MSTOP', code: 'MSTOP'},
        ]
    },
];
let toolbox = document.createElement('div'), toolboxHTML = '';
toolbox.id = "toolbox";
for (let shift of codes) {
    console.log(shift);
    toolboxHTML += '<div class="row"><h1>' + shift.title + '</h1><div class="roles">';
    for (let role of shift.roles) {
        toolboxHTML += '<button value="' + role.code + '">' + role.name + '</button>';
    }
    toolboxHTML += '</div></div>';
}
toolbox.innerHTML = toolboxHTML
document.querySelector('#body').appendChild(toolbox);
Array.from(document.querySelectorAll('#body > #toolbox > .row > .roles > button')).forEach(function(el){
    el.addEventListener('click', function () {
        document.getElementById('calmCode').value = el.value
        document.forms[0].submit()
    })
})
})();
