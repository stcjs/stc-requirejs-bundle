import {isRegExp, isString, isArray} from 'stc-helper';

export function findIncludePath(filepath,include) {
  let matches;
  if(!include){
    return false;
  }
  if(!isArray(include)) {
    include = [include];
  }
  let matchedPath = '';
  let flag = include.some(item => {
    if(isRegExp(item)){
      matches = filepath.match(item);
      if(matches){
        matchedPath = item;
        return true;
      }
    }
    if(isString(item) && filepath.indexOf(item) === 0) {
      matchedPath = item;
      return true;
    }
  });
  if(flag){
    return matchedPath;
  }
  return false;
}
export function isInclude(filepath,include) {
  let matches;
  if(!include){
    return false;
  }
  if(!isArray(include)) {
    include = [include];
  }
  let flag = include.some(item => {
    if(isRegExp(item)){
      matches = filepath.match(item);
      if(matches){
        return true;
      }
    }
    if(isString(item) && filepath === item) {
      return true;
    }
  });
  if(flag){
    return true;
  }
  return false;
}
 // babel with es2015-loose on can't correctly handle `new Map([...mapA, ...mapB]);`
// implement it.
export function concatMaps(mapA, mapB) {
  let mapC = new Map();
  if(!mapA && !mapB) {
    return mapC;
  }
  if(mapA) {
     for(let [kA, vA] of mapA) {
      mapC.set(kA, vA);
    }
  }
  if(mapB) {
    for(let [kB, vB] of mapB) {
      mapC.set(kB, vB);
    }
  }
  
  return mapC;
}
export function setBatchAdd(targetSet, sourceIterator) {
  for(let k of sourceIterator) {
    targetSet.add(k);
  }
}
export function bundleContent(map) {
  if(!map) {
    return '';
  }
  let values = map.values();
  let keys = map.keys();
  let str = [];
  for(let item of values) {
    str.push(item);
  }
  return str.join(';');
}
/*
* just for elements of primitive values
*/
export function copySetToArray(set) {
  let arr = [];
  for(let item of set) {
    arr.push(item);
  }
  return arr;
}

export function matchAll(content, reg) {
  let matchResult = [];
  let tmpContent = content;
  while(true) {
    let match = tmpContent.match(reg);
    if(!match) {
      break;
    }
    tmpContent = tmpContent.replace(match[0], '').trim();
    match[1] = match[1].trim();
    if(match[1]) {
      matchResult.push(match[1]);
    }
  }
  return matchResult;
}