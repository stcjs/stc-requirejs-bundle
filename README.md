# stc-requirejs-bundle
Combine amd modules

## Install

```sh
npm install stc-requirejs-bundle
```

## Usage

```
var requirejsBundle = require('stc-requirejs-bundle');

/** 
* @param include [optional]: files that you want to bundle
* @param baseUrl [optional]: identical with "baseUrl" in require.config
* @param commonModule [optional]: `path-moduleArray` pairs: 
* `path` are paths in which files will not have content of 
* `moduleArray` and content of `moduleArray`'s dependencies in the output.
* i.e. 'resource/js/mobile/index.js' will not have 'js/mobile/views/indexView' content in the output file, 
* even it depends on 'js/mobile/views/indexView'
* in that case, you need to include 'js/mobile/views/indexView' in your html manually.
**/
stc.workflow({
  requirejsBundle: {
    plugin: requirejsBundle, 
    include: 'resource/js/mobile/index.js', 
    options: {
      baseUrl: 'resource/',
      commonModule: {
        'resource/js/mobile/': [
          'js/mobile/views/indexView'
        ]
      }
    }
  },
});
