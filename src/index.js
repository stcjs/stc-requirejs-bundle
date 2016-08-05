import Plugin from 'stc-plugin';
import defaultOptions from './default_options';
import {extend, isExist, isRegExp, isString, isArray, isObject, isEmpty} from 'stc-helper';
import path from 'path';
import {isInclude, findIncludePath, concatMaps, bundleContent, setBatchAdd} from './helper';

const REGS = {
  MODULE: /(?:require(?:js)?|define)\s*\(/, // 是否为模块 ( Is it a module?)
  DEPS: /(?:require(?:js)?|define)\s*\([^([{]*\[([^\]]+)]/, // 依赖数组 (Get dependencies of a module)
  DEFINE: /define\s*\(/, // 是否为 define 模块 (Is it a "define" module?)
  MODULEIDEXIST: /define\s*\(\s*['"]([^([{'"]+)['"]/ // 是否有模块名（ Does the module already have a name?）
};
const maxRecursionTime = 20;
let options = null;
let commonModuleMap = null;
let commonPathArr = [];
let commonHandlingFlag = false;

export default class RequirejsBundlePlugin extends Plugin {
  getModuleName(str) {
    str = str.replace(options.staticPath, '').replace('\.js', '');
    return str;
  }
  getRelativePath(str, toCurrent) {
    if(!/\.js$/.test(str)) {
      str= options.staticPath + str +'.js';
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
        this.fatal('"' + modulename + '" doesn\'t exist in ' + this.file.path);
    }
    return jsFile;
  }
  parseCommonModules() {
    if(!isEmpty(commonModuleMap) || isEmpty(options.commonModule)) return;
    commonModuleMap = new Map();
    let key = options.jsPath;
    let optCm = options.commonModule;
    if(isString(optCm)) {
      let commonSet = new Set();
      commonSet.add(this.getModuleName(optCm));
      commonModuleMap.set(key, commonSet);
      commonPathArr.push(key);
    } else if(isObject(optCm)) {
      //check edge case
      
      optCm.forEach((path, modules) => {
        let commonSet = new Set();
        path = path.trim();
        if(path.lastIndexOf('/') != path.length-1) {
          path += '/';
        }
        //path must be child of options.jsPath;
        if(path.indexOf(key) == -1) {
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
          commonSet.add(this.getModuleName(item))
        }
        commonModuleMap[path] = commonSet;
        commonPathArr.push(path);
      });
    } else if(isArray(optCm)){
      let commonSet = new Set();
      for(let item in optCm) {
        commonSet.add(this.getModuleName(item));
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
    for(let item of commonSet) {
      let moduleName = item;
      map.delete(moduleName);
    }
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
    if(!commonHandlingFlag && !this._prop.iscommon) {
      commonHandlingFlag = true;
      for(let [path, commonSet] of commonModuleMap) {
        for(let cmodulename of commonSet) {
          let jsFile = await this.getFileByModuleName(cmodulename);
          console.log(123, cmodulename);
          let invokeResult = await this.invokeSelf(jsFile, {iscommon: true});
          console.log(125, cmodulename);
          let map = invokeResult.map;
          let modules = map.keys();
          //merge map keys into commonSet
          setBatchAdd(commonSet, modules);
        }
      }
    }
    console.log(133, this.file.path);
    let content = await this.getContent('utf8');
    let modulename = this.getModuleName(this.file.path);
    let depMap = new Map();
    let deps = [];
    let isModule = content.match(REGS.MODULE);
    let isDefineModule = content.match(REGS.DEFINE);
    let idExist = content.match(REGS.MODULEIDEXIST);

    // when invokeself , check if it's matched against the include rule
    if(!isInclude(this.file.path, options.include)) {
      depMap.set(modulename, content);
      return {map: depMap};
    }
    // if is a normal file
    if(!isModule) {
      // return the content and a module definition.
      content = content+";window.define && define('"+modulename+"', function(){})";
      depMap.set(modulename, content);
      return {map: depMap};
    }
    // get all the matched dependencies 
    let tmpContent = content;
    while(true) {
      let match = tmpContent.match(REGS.DEPS);
      if(!match) {
        break;
      }
      tmpContent = tmpContent.replace(match[0], '');
      deps.push(match[1]);
    }
    deps = deps.join(',');
  
    // give "define" a module name if has no one
    if(isDefineModule && !idExist) {
      content = content.replace(REGS.DEFINE, "define('"+modulename+"',"); 
    } else if(isDefineModule && idExist != modulename) {
      //because other modules may not recognise self-defined module name,
      //must give self-named module a new module name 
      content += ";define('"+modulename+"', function(){})";
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
        let childModuleName = item.replace(/'|"/g, "").trim();
        if(!childModuleName) continue;
        let jsFile = await this.getFileByModuleName(childModuleName);
        let invokeResult = await this.invokeSelf(jsFile);
        let moduleMap = invokeResult.map;
        
        // append child map to existing depMap. 
        // the Map merges duplicate modules automatically.
        depMap = concatMaps(depMap, moduleMap);
      }
      //remove children in common modules
      let includePath = findIncludePath(modulename, commonPathArr);
      if(includePath) {
        let commonSet = commonModuleMap.get(includePath);
        this.removeCommonModule(depMap, commonSet);
      }
      // append the current module to map
      depMap.set(modulename, content);
      return {map: depMap};
    } 
    return {
      error: 'just error'
    }
  }
 
  /**
   * update
   */
  update(data) {
    if(data.error) {
      this.error(data.error, data.line, data.column);
    }
    // output file
    if(data.map) {
      this.setContent(bundleContent(data.map));
    }
  }

  /**
   * use cluster
   */
  static cluster(){
    return false;
  }
  /**
   * use cache
   */
  static cache(){
    return true;
  }
}
