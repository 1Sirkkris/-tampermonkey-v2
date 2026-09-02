from pathlib import Path
import sys


def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def patch_core(path: Path) -> None:
    text = path.read_text()
    text = once(text, '// @name         TEST v0.2.14 FCR Data Core — MADCAT Auth Fallback', '// @name         TEST v0.2.15 FCR Data Core — MADCAT Session Keepalive', 'name')
    text = once(text, '// @version      0.2.14', '// @version      0.2.15', 'metadata version')
    text = once(text, '// @description  Strict exact-item binDescription plus 30-day raw MADCAT with automatic Inventory History fallback when measurement auth is unavailable.', '// @description  Strict binDescription plus 30-day raw MADCAT with Item Measurement session keepalive and automatic Inventory History fallback.', 'description')
    text = once(text, "const VERSION = '0.2.14';", "const VERSION = '0.2.15';", 'runtime version')

    text = once(text,
        "    const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;\n    const bridgeLaunch = new URLSearchParams(location.search).get('fcrMadcatBridge') === '1';\n    let closeTimer = 0;\n",
        "    const pageWindow = typeof unsafeWindow === 'object' && unsafeWindow ? unsafeWindow : window;\n    const params = new URLSearchParams(location.search);\n    const bridgeLaunch = params.get('fcrMadcatBridge') === '1';\n    const keepaliveLaunch = params.get('fcrMadcatKeepalive') === '1';\n    let closeTimer = 0;\n    let keepaliveTimer = 0;\n",
        'bridge flags')

    text = once(text,
        "      try {\n        GM_setValue(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...pack, capturedAt: Date.now() }));\n      } catch {\n        return false;\n      }\n      if (bridgeLaunch && !closeTimer) {\n        closeTimer = setTimeout(() => {\n          try { pageWindow.close(); } catch {}\n        }, 700);\n      }\n      return true;\n",
        "      try {\n        GM_setValue(MEASUREMENT_AUTH_KEY, JSON.stringify({ ...pack, capturedAt: Date.now() }));\n      } catch {\n        return false;\n      }\n      if (keepaliveLaunch) {\n        clearTimeout(keepaliveTimer);\n        const untilExpiry = Math.max(0, pack.exp - Date.now());\n        const refreshIn = Math.max(5 * 60 * 1000, Math.min(45 * 60 * 1000, untilExpiry - 10 * 60 * 1000));\n        keepaliveTimer = setTimeout(() => {\n          try { location.reload(); } catch {}\n        }, refreshIn);\n      }\n      if (bridgeLaunch && !keepaliveLaunch && !closeTimer) {\n        closeTimer = setTimeout(() => {\n          try { pageWindow.close(); } catch {}\n        }, 700);\n      }\n      return true;\n",
        'keepalive schedule')

    text = once(text,
        "    for (const store of [pageWindow.localStorage, pageWindow.sessionStorage]) {\n      try {\n        for (let index = 0; index < store.length; index++) inspectText(store.getItem(store.key(index)));\n      } catch {}\n    }\n",
        "    const inspectStores = () => {\n      for (const store of [pageWindow.localStorage, pageWindow.sessionStorage]) {\n        try {\n          for (let index = 0; index < store.length; index++) inspectText(store.getItem(store.key(index)));\n        } catch {}\n      }\n    };\n    inspectStores();\n    if (keepaliveLaunch) setInterval(inspectStores, 5000);\n",
        'storage polling')

    path.write_text(text)


def patch_readme(path: Path) -> None:
    text = path.read_text()
    if '| FCR Data Core | 0.2.14 |' in text:
        text = text.replace('| FCR Data Core | 0.2.14 |', '| FCR Data Core | 0.2.15 |', 1)
    elif '| FCR Data Core | 0.2.13 |' in text:
        text = text.replace('| FCR Data Core | 0.2.13 |', '| FCR Data Core | 0.2.15 |', 1)
    else:
        raise SystemExit('README Core version row not found')
    path.write_text(text)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: patch_helper CORE_PATH README_PATH')
    patch_core(Path(sys.argv[1]))
    patch_readme(Path(sys.argv[2]))
