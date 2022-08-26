const fs = require('fs');
const path = require('path');
const jsesc = require('jsesc');
const { minify } = require("terser");

const OUT_DIR = process.env.RNG_OUT || "./gen/";
const XRE_GENERATED = process.env.RNG_XRE_GENERATED || ".";

function writeFile(name, object) {
    console.log(`Saving ${name}…`);
    if (typeof object != "string") {
        object = jsesc(object);
    }
    fs.writeFileSync(path.join(OUT_DIR, name), object);
};

async function clean_out() {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function collate_unicode() {
    const SORUCES = {
        "Categories": "categories.js",
        "Properties": "properties.js",
        "Scripts": "scripts.js",
    };

    const aliases = {};
    const ranges = {};
    for (const [name, file] of Object.entries(SORUCES)) {
        console.log(`Adding ${name}…`);
        const table = require(path.join(XRE_GENERATED, file));
        table.map((data) => {
            if (!data.bmp)
                return;
            if (data.alias) {
                aliases[data.alias.toLowerCase()] = data.name.toLowerCase();
            }
            ranges[data.name.toLowerCase()] = data.bmp;
        })
    }

    writeFile("unicodemap.json", {aliases, ranges});
}

async function minify_polyfill() {
    const code = fs.readFileSync("polyfill.js", "utf8");
    const options = {
        compress: {},
        mangle: {}
    };

    async function mini(defs={}) {
        const o = Object.assign({}, options, {compress:{global_defs:defs}});
        return (await minify(code, o)).code.replace(/^.+CC_USED_ARG=/,"");
    }

    writeFile("polyfill.transform.js",
              (await mini({CC_RUNTIME:false})));
    writeFile("polyfill.rt.jss",
              "jss`!" + (await mini({CC_HOST:false})).replaceAll(/\${|`/g, "\$0") + "`");
    writeFile("polyfill.min.js",
              (await mini({CC_HOST:false})));
    writeFile("polyfill.all.js", await mini());
}

!async function () {
    await clean_out();
    await collate_unicode();
    await minify_polyfill();
}()