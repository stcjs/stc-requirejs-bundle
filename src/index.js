import Plugin from 'stc-plugin';
import defaultOptions from './default_options';
import {extend, isExist, isRegExp, isString, isArray, isObject, isEmpty} from 'stc-helper';
import path from 'path';
import {isInclude, findIncludePath, concatMaps, bundleContent, setBatchAdd, copySetToArray, matchAll} from './helper';

const REGS = {
  MODULE: /(?:require(?:js)?|define)\s*\(/, // 是否为模块 ( Is it a module?)
  DEPS: /(?:require(?:js)?|define)\s*\([^([{]*\[([^\]]+)]/, // 依赖数组 (Get dependencies of a module)
  DEFINE: /define\s*\(/, // 是否为 define 模块 (Is it a "define" module?)
  MODULEIDEXIST: /define\s*\(\s*['"]([^([{'"]+)['"]/ // 是否有模块名（ Does the module already have a name?）
};
const maxRecursionTime = 20;
let options = null;
let commonModuleMap = null;
let commonModuleSet = null;
let commonPathArr = [];

let globalDependences = new Map();
export default class RequirejsBundlePlugin extends Plugin {
  getModuleName(str) {
    str = str.replace(options.baseUrl, '').replace('\.js', '');
    return str;
  }
  getRelativePath(str, toCurrent) {
    if(!/\.js$/.test(str)) {
      str= options.baseUrl + str +'.js';
    }
    if(!toCurrent) {
      return str;
    }
    let currentFilePath = path.dirname(this.file.path);
    let relativePath = path.relative(currentFilePath, str);
    return relativePath;
  }
  async getFileByModuleName(modulename) {
    let jsPath = this.getRelativePath(modulename, true);
    let jsFile = null;
    try {
      jsFile = await this.getFileByPath(jsPath);
    } catch(e) {
      console.log(e);
    }
    return jsFile;
  }
  parseCommonModules() {
    if(!isEmpty(commonModuleMap) || isEmpty(options.commonModule)) return;
    commonModuleMap = new Map();
    commonModuleSet = new Set();
    let key = options.jsPath;
    let optCm = options.commonModule;
    if(isString(optCm)) {
      let commonSet = new Set();
      let modulename = this.getModuleName(optCm);
      commonSet.add(modulename);
      commonModuleSet.add(modulename);
      commonModuleMap.set(key, commonSet);
      commonPathArr.push(key);
    } else if(isObject(optCm)) {
      //check edge case
      optCm.forEach((path, modules) => {
        let commonSet = new Set();
        path = path.trim();
        if(path.lastIndexOf('/') !== path.length-1) {
          path += '/';
        }
        //path must be child of options.jsPath;
        if(path.indexOf(key) === -1) {
          path = key + path;
        }
        //if not exist, log error.
        if(!isExist(path)) {
          this.error(path+' doesn\'t exist');
        }
        // 'path' => 'js/page/common'
        if(!isArray(modules)) {
          modules = [modules];
        }
        for(let item in modules) {
          let modulename = this.getModuleName(item);
          commonSet.add(modulename);
          commonModuleSet.add(modulename);
        }
        commonModuleMap[path] = commonSet;
        commonPathArr.push(path);
      });
    } else if(isArray(optCm)){
      let commonSet = new Set();
      for(let item in optCm) {
        let modulename = this.getModuleName(item);
        commonSet.add(modulename);
        commonModuleSet.add(modulename);
      }
      commonModuleMap = {
        [key]: commonSet
      };
      commonPathArr.push(key);
    }
  }
 
  /***
   * if a file is under a common path, 
   * remove duplicate common modules of that paths 
   * from the file's depMap
  */
  removeCommonModule(map, commonSet) {
    if(!commonSet) return;
    for(let item of commonSet) {
      let moduleName = item;
      map.delete(moduleName);
    }
  }
  isInCommonModuleSet() {
    let modulename = this.getModuleName(this.file.path);
    if(commonModuleSet) {
      return commonModuleSet.has(modulename);
    } else {
      return false;
    }
  }
  static once() {
    return false;
  }
 
  /**
   * run
   */
  async run() {
    if(!options) {
      options = extend(defaultOptions, {
        include: this.include
      }, this.options);
    }
    //First, process common modules
    if(!commonModuleMap) {
      this.parseCommonModules();
    }
    
    if(!this.prop('iscommon')) {
      if(this.isInCommonModuleSet()) {
        return false;
      }
      await this.await('generate_common_modules', async () => {
        if(commonModuleMap) {
         for(let [path, commonSet] of commonModuleMap) {
           //make Set static, avoid repeating modules
            let arr = copySetToArray(commonSet);
            for(let cmodulename of arr) {
              let jsFile = await this.getFileByModuleName(cmodulename);
              if(!jsFile) continue;
              let invokeResult = await this.invokeSelf(jsFile, {iscommon: true});
              let map = invokeResult.map;
              let modules = map.keys();
              //merge map keys into commonSet
              setBatchAdd(commonSet, modules);
            }
          }
        }
      });
    }
    let content = await this.getContent('utf8');
    let modulename = this.getModuleName(this.file.path);
    let depMap = new Map();
    let deps = [];
    let existIds = [];
    let isModule = content.match(REGS.MODULE);
    let isDefineModule = content.match(REGS.DEFINE);
  
    if(!isModule) {
      // return the content and a module definition.
      content = content+';window.define && define(\''+modulename+'\', function(){})';
      depMap.set(modulename, content);
      return {map: depMap};
    }
    
    // get all the matched dependencies 
    deps = matchAll(content, REGS.DEPS);
    deps = deps.join(',');
    existIds = matchAll(content, REGS.MODULEIDEXIST);
    
    // give "define" a module name if has no one
    if(isDefineModule && !existIds.length) {
      content = content.replace(REGS.DEFINE, 'define(\''+modulename+'\','); 
    } else if(isDefineModule && existIds.indexOf(modulename) === -1) {
      //because other modules may not recognise self-defined module name,
      //must give self-named module a new module name 
      content += ';define(\''+modulename+'\', function(){})';
    }

    // it's a termination of dependencies, i.e. it has no dependency
    if(isDefineModule && !deps) {
      depMap.set(modulename, content);
      return {map: depMap};
    }

    // we've handled terminate conditions of the recursion,
    // let's deal with dependencies now.
    if(deps) {
      let depArr = deps.split(',');
      for(let index in depArr) {
        let item = depArr[index];
        let childModuleName = item.replace(/'|"/g, '').trim();
        if(!childModuleName || item.trim() === childModuleName) continue;
        let jsFile = await this.getFileByModuleName(childModuleName);
        if(!jsFile) continue;
        let invokeResult = await this.invokeSelf(jsFile, {iscommon: this.prop('iscommon'), _from: this.file.path});
        let moduleMap = invokeResult.map;
        // append child map to existing depMap. 
        // the Map merges duplicate modules automatically.
        depMap = concatMaps(depMap, moduleMap);
      }
      //remove children in common modules
      let includePath = findIncludePath(modulename, commonPathArr);
      if(includePath && commonModuleMap) {
        let commonSet = commonModuleMap.get(includePath);
        this.removeCommonModule(depMap, commonSet);
      }
      
      // append the current module to map
      depMap.set(modulename, content);
     
      return {map: depMap};
    }
    depMap.set(modulename, content);
    return {map: depMap};
  }
  /**
   * update
   */
  update(data) {
    if(!data) return;
    if(data.error) {
      this.error(data.error, data.line, data.column);
    }
    // output file
    if(!isInclude(this.file.path, options.include)) {
      return;
    }
    if(data.map && data.map instanceof Map) {
      if(!globalDependences.has(this.file.path)) {
          globalDependences.set(this.file.path, data.map);
      }
    }
  }

  static after(files, instance) {
    for(let index in files) {
      let file = files[index];
      let path = file.path;
      let map = globalDependences.get(path);
      let content = bundleContent(map);
      file.setContent(content);
    }
  }

  /**
   * use cluster
   */
  static cluster() {
    return false;
  }
  /**
   * use cache
   */
  static cache() {
    return false;
  }
}