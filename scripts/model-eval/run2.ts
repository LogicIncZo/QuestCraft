import { buildTasks } from './harness2';
import { callModel } from './call2';
import { scoreQuest, scoreScenario, scoreChoice, scoreChat, type Scored } from './score2';
import { writeFileSync, appendFileSync } from 'fs';

const MODELS = [
  { id: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', pricing: { in: 0.000000269, out: 0.0000004 } },
  { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', pricing: { in: 0.00000009, out: 0.00000034 } },
  { id: 'google/gemma-3-27b-it', label: 'Gemma 3 27B', pricing: { in: 0.00000011, out: 0.00000043 } },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3-Flash', pricing: { in: 0.000000075, out: 0.00000025 } },
  { id: 'qwen/qwen3.5-397b-a17b', label: 'Qwen3.5 397B', pricing: { in: 0.00000055, out: 0.0000035 } },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (baseline)', pricing: { in: 0.0000003, out: 0.0000025 } },
];

const jobs: { m: typeof MODELS[0]; task: any }[] = [];
for (const m of MODELS) {
  for (const task of buildTasks('quest_outline')) jobs.push({ m, task });
  for (const task of buildTasks('quest_outline_ta')) jobs.push({ m, task });
}
console.log(`total jobs: ${jobs.length}`);
const results: any[] = [];
let done = 0;
const runJob = async ({ m, task }: { m: typeof MODELS[0]; task: any }) => {
  let r = await callModel(m.id, task.system, task.user, task.jsonMode);
  if (r.error && /timeout/.test(r.error) && task.key.startsWith('quest_outline')) {
    console.log(`retry-after-timeout ${m.label} ${task.key}`);
    r = await callModel(m.id, task.system, task.user, task.jsonMode);
  }
  let s: Scored;
  if (task.key.startsWith('quest_outline')) s = scoreQuest(r, { numLocations: 20, positivity: 0.7, grounding: false });
  else if (task.key === 'dynamic_scenario') s = scoreScenario(r);
  else if (task.key === 'player_choice') s = scoreChoice(r, task.correct);
  else s = scoreChat(r);
  const rec = { model: m.label, modelId: m.id, pricing: m.pricing, task: task.key, correct: task.correct, ...s, choiceSemanticOK: task.key === 'player_choice' ? s.choiceIdx === task.correct : undefined };
  results.push(rec);
  done++;
  appendFileSync('/home/.z/workspaces/con_a8idg7ESQMERdQVS/eval/progress2.log', `${done}/${jobs.length} ${m.label} ${task.key}: tier=${s.tier} valid=${s.valid} semantic=${rec.choiceSemanticOK} (${Math.round(s.latencyMs / 1000)}s)\n`);
};
const CONC = 3;
const queue = [...jobs];
const worker = async () => { while (queue.length) { const j = queue.shift()!; try { await runJob(j); } catch (e) { console.error('JOB FAIL', e); } } };
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync('/home/.z/workspaces/con_a8idg7ESQMERdQVS/eval/results2.json', JSON.stringify(results, null, 1));
console.log('WROTE results2.json', results.length);
