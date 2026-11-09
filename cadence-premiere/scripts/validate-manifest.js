'use strict';
/*
 * Valide CSXS/manifest.xml contre le schéma officiel Adobe ExtensionManifest_v_7_0.xsd
 * (Adobe indique que ce schéma reste valable pour les versions CEP suivantes).
 * Le schéma est téléchargé une fois depuis github.com/Adobe-CEP/CEP-Resources puis mis en cache.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const XSD_URL = 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_7.x/ExtensionManifest_v_7_0.xsd';
const CACHE = path.join(__dirname, '.cache', 'ExtensionManifest_v_7_0.xsd');
const MANIFEST = path.join(__dirname, '..', 'extension', 'CSXS', 'manifest.xml');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => { data += c; }); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  let xsd;
  if (fs.existsSync(CACHE)) xsd = fs.readFileSync(CACHE, 'utf8');
  else {
    try {
      xsd = await download(XSD_URL);
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, xsd);
    } catch (e) {
      console.error('Schéma Adobe indisponible (hors connexion ?) : ' + e.message + '. Validation XSD non effectuée.');
      process.exit(2);
    }
  }
  const { validateXML } = await import('xmllint-wasm');
  const result = await validateXML({
    xml: [{ fileName: 'manifest.xml', contents: fs.readFileSync(MANIFEST, 'utf8') }],
    schema: [{ fileName: 'ExtensionManifest_v_7_0.xsd', contents: xsd }]
  });
  if (result.valid) {
    console.log('manifest.xml est valide selon ExtensionManifest_v_7_0.xsd (Adobe).');
  } else {
    console.error('manifest.xml INVALIDE :');
    result.errors.forEach(e => console.error('  ' + (e.rawMessage || e.message || JSON.stringify(e))));
    process.exit(1);
  }
})();
