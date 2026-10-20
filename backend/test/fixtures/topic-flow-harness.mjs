// No real Auth/DB, retrieval, logging, or network connections. The caller supplies
// the model client so the same production function can be tested deterministically
// or with an explicitly approved synthetic-only paid batch.
import { mock } from 'node:test'
const url=(path)=>new URL('../../src/lib/'+path,import.meta.url).href
export async function topicFlowHarness(client) {
 const writes=[]
 const db={from(table){let payload=null; const q={select(){return q},eq(){return q},order(){return q},limit(){return q},insert(value){payload=value;writes.push({table,type:'insert',payload:structuredClone(value)});return q},update(value){payload=value;writes.push({table,type:'update',payload:structuredClone(value)});return q},async single(){return {data:structuredClone(payload || {}),error:null}},async maybeSingle(){return {data:null,error:null}},then(resolve){return Promise.resolve({data:structuredClone(payload || {}),error:null}).then(resolve)}};return q}}
 mock.module(url('supabase.js'),{namedExports:{hasSupabaseAdminConfig:()=>true,getSupabaseAdmin:()=>db}})
 mock.module(url('openai.js'),{namedExports:{hasOpenAIConfig:()=>true,getOpenAIClient:()=>client,getOpenAIModels:()=>({variationModel:'gpt-5.2',copilotModel:'gpt-5.2',chatModel:'gpt-5.2'})}})
 mock.module(url('ai-error-logger.js'),{namedExports:{logAIError(){}}})
 mock.module(url('ai-usage-logger.js'),{namedExports:{logAIUsage(){}}})
 mock.module(url('hook-templates.js'),{namedExports:{retrieveHookTemplates:async()=>({templates:[]}),formatHookTemplatesForPrompt:()=>''}})
 mock.module(url('narrative-patterns.js'),{namedExports:{retrieveNarrativePatterns:async()=>({patterns:[]}),formatNarrativePatternsForPrompt:()=>''}})
 mock.module(url('writing-playbook.js'),{namedExports:{retrieveWritingPlaybookRulesForSentences:async()=>({rules:[]}),formatWritingPlaybookRulesForPrompt:()=>''}})
 const {generateTopicOnlyScripts}=await import(url('topic-script-generation.js'))
 return {generateTopicOnlyScripts,writes,reset(){writes.length=0}}
}
