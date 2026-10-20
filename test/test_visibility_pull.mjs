// Execute the real visibility and pull functions from web/index.html against
// scene-shaped objects. Network responses are queued locally in apiFetch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HTML_PATH = path.join(ROOT, 'web', 'index.html');
const html = readFileSync(HTML_PATH, 'utf8');

function extractFn(name){
  const marker = 'function ' + name + '(';
  let start = html.indexOf(marker);
  assert.ok(start >= 0, `${name} not found in web/index.html`);
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  let depth = 0, i = html.indexOf('{', start), end = -1;
  for (; i < html.length; i++){
    if (html[i] === '{') depth++;
    else if (html[i] === '}'){
      depth--;
      if (depth === 0){ end = i + 1; break; }
    }
  }
  assert.ok(end > start, `could not bound ${name}`);
  return html.slice(start, end);
}

const source = [
  extractFn('showsPersistentAgentLabel'),
  extractFn('setNamesVisible'),
  extractFn('setAnnotationsVisible'),
  extractFn('applyLayerVisibility'),
  extractFn('applyCommand'),
  extractFn('apiPull'),
].join('\n');

const fixture = `
let view = {namesVisible:true, annotationsVisible:true, selection:new Set()};
let layerState = {workItems:true, agents:true, arrows:true, agentGraph:true,
  obligations:true, agentLabels:true, annotations:true};
let apiSeq = 0, apiTagsRev = -1, apiGen = null, apiUp = false, apiJoined = false;
let tags = [], arrows = [], arrowsRev = -1;
let searches = [], searchesRev = -1, followups = [], followupsRev = -1;
let selecting = false;
const arrowGroup = {visible:true};
const tetherGroup = {visible:true};
const linkGroup = {visible:true};
const agentTag = {isSprite:true, userData:{isTag:true}, visible:true};
const agentLabel = {isSprite:true, userData:{isAgentLabel:true}, visible:true};
const itemTag = {isSprite:true, userData:{isTag:true}, visible:true};
const agentNode = {userData:{a:{id:'s_fixture'}, dim:1, tagSprites:[agentTag]},
  children:[agentLabel, agentTag], material:{visible:true}};
const itemNode = {userData:{w:{id:'wi_fixture'}, dim:1, tagSprites:[itemTag]},
  children:[itemTag], material:{visible:true}};
const groundGroup = {children:[agentNode]};
const itemGroup = {children:[itemNode]};
const selectables = () => [agentNode, itemNode];
function renderDetail(){}
function buildTags(){}
function buildArrows(){}
function checkArrowFocusValidity(){}
function renderCards(){}
function renderDesk(){}
const pullQueue = [];
const pullPaths = [];
async function apiFetch(path){ pullPaths.push(path); return pullQueue.shift(); }
${source}
`;

const context = {assert};
vm.createContext(context);
vm.runInContext(fixture, context, {filename: HTML_PATH});

await vm.runInContext(`
(async () => {
  const fixtureTags = [{tagId:'tag-1', target:'s_fixture', text:'agent tag'}];
  const fixtureArrows = [{arrowId:'arrow-1', from:'s_fixture', to:'wi_fixture'}];
  const original = JSON.stringify({tags:fixtureTags, arrows:fixtureArrows});
  tags = fixtureTags.slice(); arrows = fixtureArrows.slice();

  assert.equal(showsPersistentAgentLabel({kind:'pdo', retired:false}), true,
    'active PDOs receive persistent name labels');
  assert.equal(showsPersistentAgentLabel({kind:'agent', retired:false}), false,
    'other agent kinds keep existing tooltip-only behavior');
  assert.equal(showsPersistentAgentLabel({kind:'pdo', retired:true}), false,
    'retired PDOs keep existing no-label behavior');

  setNamesVisible(false);
  assert.equal(agentLabel.visible, false, 'local names off hides an existing label');
  assert.deepEqual(
    {agentTag:agentTag.visible, itemTag:itemTag.visible, arrow:arrowGroup.visible},
    {agentTag:true, itemTag:true, arrow:true},
    'name visibility does not affect annotations');
  assert.equal(JSON.stringify({tags, arrows}), original, 'local name toggle preserves annotations');

  setAnnotationsVisible(false);
  applyLayerVisibility();
  assert.deepEqual(
    {agentTag:agentTag.visible, itemTag:itemTag.visible, arrow:arrowGroup.visible},
    {agentTag:false, itemTag:false, arrow:false},
    'layer rebuild cannot restore annotations while annotations are off');
  assert.equal(JSON.stringify({tags, arrows}), original, 'local annotation toggle preserves data');

  layerState.arrows = false;
  layerState.annotations = false;
  setAnnotationsVisible(true);
  assert.deepEqual(
    {agentTag:agentTag.visible, itemTag:itemTag.visible, arrow:arrowGroup.visible},
    {agentTag:false, itemTag:false, arrow:false},
    'annotations on does not bypass independent local layer gates');
  assert.equal(JSON.stringify({tags, arrows}), original, 'local layer gates preserve annotation data');

  layerState.arrows = true;
  layerState.annotations = true;
  setNamesVisible(true);
  pullQueue.push({generation:'fixture-g1', seq:1, gap:false, commands:[],
    tagsRev:1, tags:fixtureTags, arrowsRev:1, arrows:fixtureArrows,
    searchesRev:0, searches:[], namesVisible:false, annotationsVisible:true,
    followupsRev:0, followups:[]});
  await apiPull();
  assert.equal(agentLabel.visible, false, '/api/pull names=false hides an existing label');
  assert.deepEqual(
    {agentTag:agentTag.visible, itemTag:itemTag.visible, arrow:arrowGroup.visible},
    {agentTag:true, itemTag:true, arrow:true},
    '/api/pull name visibility does not affect annotations');

  pullQueue.push({generation:'fixture-g1', seq:2, gap:false, commands:[],
    tagsRev:1, tags:fixtureTags, arrowsRev:1, arrows:fixtureArrows,
    searchesRev:0, searches:[], namesVisible:false, annotationsVisible:false,
    followupsRev:0, followups:[]});
  await apiPull();
  applyLayerVisibility();
  assert.deepEqual(
    {agentTag:agentTag.visible, itemTag:itemTag.visible, arrow:arrowGroup.visible},
    {agentTag:false, itemTag:false, arrow:false},
    '/api/pull annotations=false survives a layer rebuild');
  assert.equal(JSON.stringify({tags, arrows}), original, 'pull visibility changes preserve data');
  assert.deepEqual(pullPaths, ['/pull?since=0', '/pull?since=1']);
  globalThis.result = {apiSeq, apiUp};
})()
`, context, {filename: HTML_PATH});

assert.equal(context.result.apiSeq, 2);
assert.equal(context.result.apiUp, true);
console.log('test_visibility_pull.mjs: all assertions passed');
