// ==UserScript==
// @name         Bind Hierarchy Queue
// @name:en      Bind Hierarchy Queue
// @namespace    BWU2
// @version      0.2.0
// @description  Compatibility loader for the unified BWU2 Hierarchy Queue.
// @match        https://tx-b-hierarchy-nrt.nrt.proxy.amazon.com/bindHierarchy*
// @run-at       document-start
// @grant        none
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Actions_Core.lib.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/BWU2_Fleet_Core.lib.js
// @require      https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Unbind_Hierarchy_Queue.user.js
// @updateURL    https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// @downloadURL  https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/main/Bind_Hierarchy_Queue.user.js
// ==/UserScript==

// Bind now lives in the unified Hierarchy Queue above.
// This file remains only so existing Bind installs migrate cleanly.
