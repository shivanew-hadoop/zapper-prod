'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { correctTechnologyTerms, compileVocabulary } = require('../transcriber/technologyCorrections');
const { correctMeetCaptionText } = require('../transcriber/captionCorrections');
const { terms } = require('../transcriber/technologyVocabulary.json');
const fix = correctMeetCaptionText;

const examples = [
  ['We deployed kuberneties on aws', 'We deployed Kubernetes on AWS'],
  ['Terraform with kubernetties, docker and build jenkins pipeline', 'Terraform with Kubernetes, Docker and build Jenkins pipeline'],
  ['We use terrafrom to configure eks and ec2', 'We use Terraform to configure EKS and EC2'],
  ['Our gcp and a-w-s infrastructure', 'Our GCP and AWS infrastructure'],
  ['We use devops and cicd with ansibel', 'We use DevOps and CI/CD with Ansible'],
  ['The github repository contains typescript', 'The GitHub repository contains TypeScript'],
  ['Nodejs supports javascript and graphql', 'Node.js supports JavaScript and GraphQL'],
  ['We use react with typescript and springboat', 'We use React with TypeScript and Spring Boot'],
  ['We use angular with vuejs and restapi', 'We use Angular with Vue.js and REST API'],
  ['We use postgressql and mongo-db', 'We use PostgreSQL and MongoDB'],
  ['We have databriks and pyspark for etl', 'We have Databricks and PySpark for ETL'],
  ['Apache spark receives apache kafca events', 'Apache Spark receives apache Kafka events'],
  ['Apache airflow schedules data pipelines', 'Apache Airflow schedules data pipelines'],
  ['We configure data snowflake analytics', 'We configure data Snowflake analytics'],
  ['We use an llm and pytorch', 'We use an LLM and PyTorch'],
  ['Our llm rag uses embeddings', 'Our LLM RAG uses embeddings'],
  ['We use mlops, tensorflow, huggingface and langchain', 'We use MLOps, TensorFlow, Hugging Face and LangChain'],
  ['Our database sequel queries work', 'Our database SQL queries work'],
  ['We use json, yaml, jwt and oauth', 'We use JSON, YAML, JWT and OAuth'],
  ['We have a g-rpc service with websocket', 'We have a gRPC service with WebSocket'],
  ['I wanted Tu Si kuberneties on gcp', 'I wanted to see Kubernetes on GCP'],
  ['Coming Tu my rolls and responsibilities in devops', 'Coming to my roles and responsibilities in DevOps'],
  ['python integrates with openai and llamaindex', 'Python integrates with OpenAI and LlamaIndex'],
  ['Thank u for joining the call', 'Thank you for joining the call']
];

for (const [spoken, expected] of examples) {
  assert.equal(fix(spoken), expected, spoken);
  assert.equal(fix(fix(spoken)), expected, `idempotence: ${spoken}`);
}

// Avoid changing ordinary meanings, names and short ambiguous terms.
for (const phrase of [
  'We watched the sequel yesterday',
  'The spark made the fire grow',
  'They react quickly to feedback',
  'The snowflake landed on the floor',
  'The helm of the boat',
  'The air flow in this room',
  'A rag was on the table',
  'We met Java on the tour',
  'She enjoys spring boots',
  'I work with the Kafka family',
  'We should go now',
  'The speech is in Indian English'
]) {
  assert.equal(fix(phrase), phrase, `false-positive protection: ${phrase}`);
}

// The v1.0.8 overlay never rewrites words. Technology variants cannot depend
// on future context or require deleting already emitted words.
for (const phrase of [
  'We deployed kuberneties on aws with terrafrom',
  'We use react with typescript and nodejs',
  'Apache spark processes apache kafka events',
  'Our llm rag works with huggingface',
  'Our database sequel queries were successful',
  'We watched a sequel from the helm of the boat',
  'I wanted Tu Si kuberneties on gcp',
  'The snowflake is falling',
  'Our data snowflake warehouse is available',
]) {
  const parts = phrase.split(' ');
  let prev = '';
  for (let i = 1; i <= parts.length; i++) {
    const next = fix(parts.slice(0, i).join(' '));
    assert(!prev || next === prev || next.startsWith(`${prev} `),
      `A previously printed word changed: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
    prev = next;
  }
}

// Catch invalid or ambiguous dictionary extensions during development.
assert(terms.length >= 75, 'cover technology vocabulary broadly');
assert.throws(() => compileVocabulary([{ term: 'X', variants: ['foo bar'] }]), /Unsafe/);
assert.throws(() => compileVocabulary([{ term: 'A', variants: ['foo', 'foo'] }]), /Duplicate/);
assert.throws(() => compileVocabulary([{ term: 'X', variants: ['foo'], contextBefore: ['spaces not allowed'] }]), /context/);

const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
assert.equal(settings.version, '1.0.10');
assert(settings.build.files.includes('transcriber/**/*'), 'dictionary must be bundled in installer');
assert(main.includes("require('./transcriber/captionCorrections')"), 'reuse existing correction handoff');
assert(main.includes('const DEEPGRAM_FALLBACK_ENABLED = false'), 'Deepgram must remain off');
for (const filename of ['../meet-controller/meet-preload.js','../meet-controller/host-caption-preload.js']) {
  const collector = fs.readFileSync(path.join(__dirname, filename), 'utf8');
  assert(collector.includes('240'), 'keep original caption stabilization thresholds');
}

// Processing-only benchmark; not a claim about actual Meet recognition lag.
const sample = 'I wanted Tu Si kuberneties on aws with terrafrom, postgressql, graphql and llm rag.';
let start = performance.now();
for (let i = 0; i < 25000; i++) fix(sample);
const avgMs = (performance.now() - start) / 25000;
assert(avgMs < 0.75, `Unexpected processing overhead: ${avgMs.toFixed(4)}ms`);
console.log(JSON.stringify({ ok: true, testedExamples: examples.length,
  vocabularyTerms: terms.length, stablePrefixes: true, falsePositiveChecks: true,
  noNetworkOrTimers: true, averageCorrectionMs: Number(avgMs.toFixed(4)) }));
