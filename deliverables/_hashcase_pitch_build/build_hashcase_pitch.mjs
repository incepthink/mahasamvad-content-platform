import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const SKILL_DIR = 'C:/Users/shaik/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.11814/skills/presentations';
const WORKSPACE = 'C:/Users/shaik/Desktop/dev-work/mahasamvad-content-platform';
const BUILD = path.join(WORKSPACE, 'deliverables/_hashcase_pitch_build');
const OUT = path.join(WORKSPACE, 'deliverables/HashCase_Pitch_Deck/HashCase_Client_Pitch.pptx');
const PYTHON = 'C:/Users/shaik/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);

const W = 1280, H = 720;
const C = {
  ink: '#172235', dark: '#0B101B', navy: '#121D31', navy2: '#182842',
  paper: '#F7F8FA', white: '#FFFFFF', line: '#DCE3EA', muted: '#536174',
  blue: '#2675F5', blue2: '#1663D9', violet: '#9251CE', lavender: '#EEE9F8',
  paleBlue: '#EAF2FF', soft: '#EEF2F7', green: '#287867', paleGreen: '#E9F3F0',
  warm: '#D56A4A', paleWarm: '#FBEEE9', gold: '#E3BC75'
};
const FONT = 'Segoe UI';
const HEAD = 'Bahnschrift';
const pres = Presentation.create({ slideSize: { width: W, height: H } });
const img = async n => new Uint8Array(await fs.readFile(path.join(BUILD, 'assets', n)));
const coverBytes = await img('cover-office.png');
const infraBytes = await img('private-infra.png');
const logoBytes = await img('hashcase-logo.png');

function slide(bg=C.paper) { const s=pres.slides.add(); s.background.fill=bg; return s; }
function box(s,x,y,w,h,fill,stroke='none',radius=0) {
  return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,
    line:{fill:stroke,width:stroke==='none'?0:1},...(radius?{borderRadius:radius}:{})});
}
function line(s,x1,y1,x2,y2,color=C.line,width=1) {
  return s.shapes.add({geometry:'line',position:{left:x1,top:y1,width:x2-x1,height:y2-y1},fill:'none',line:{fill:color,width}});
}
function text(s,t,x,y,w,h,opt={}) {
  const sh=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  sh.text=t;
  sh.text.style={typeface:opt.font||FONT,fontSize:opt.size||22,bold:opt.bold||false,color:opt.color||C.ink,
    alignment:opt.align||'left',verticalAlignment:opt.valign||'middle',autoFit:'none',wrap:'word',
    lineSpacing:opt.leading||1.1,insets:{left:0,right:0,top:0,bottom:0}};
  return sh;
}
function image(s,bytes,x,y,w,h,alt,fit='cover') {
  return s.images.add({blob:bytes,contentType:'image/png',alt,fit,position:{left:x,top:y,width:w,height:h}});
}
function label(s,t,num,dark=false){
  text(s,t.toUpperCase(),70,45,1000,20,{font:HEAD,size:15,bold:true,color:dark?C.gold:C.violet});
  text(s,String(num).padStart(2,'0'),1172,44,40,24,{font:HEAD,size:15,bold:true,color:dark?'#B1C1D7':C.muted,align:'right'});
}
function title(s,t,y=85,dark=false,size=48){text(s,t,70,y,1135,105,{font:HEAD,size,bold:true,color:dark?C.white:C.ink,leading:1.03});}
function footer(s,num,dark=false,note='HASHCASE  /  CLIENT CAPABILITIES'){
  line(s,70,673,1210,673,dark?'#516179':C.line,1);
  text(s,note,70,681,950,15,{font:HEAD,size:12,bold:true,color:dark?'#A9B8CC':C.muted});
  text(s,String(num).padStart(2,'0'),1168,680,40,17,{font:HEAD,size:12,color:dark?'#A9B8CC':C.muted,align:'right'});
}
function note(s, t){s.speakerNotes.textFrame.setText(t);}
function chip(s,t,x,y,w,fill=C.paleBlue,color=C.blue){box(s,x,y,w,30,fill,'none',15);text(s,t,x+12,y+4,w-24,22,{font:HEAD,size:13,bold:true,color});}
function card(s,x,y,w,h,fill=C.white){return box(s,x,y,w,h,fill,C.line,7);}

// 01 — cover
{
 const s=slide(C.dark); image(s,coverBytes,0,0,W,H,'Editorial image of operations team reviewing source documents');
 box(s,0,0,575,H,'#000000');
 text(s,'HASHCASE  /  APPLIED AI',68,62,455,30,{font:HEAD,size:17,bold:true,color:C.gold});
 text(s,'AI that gets\nthe work done.',68,176,505,200,{font:HEAD,size:63,bold:true,color:C.white,leading:0.99});
 text(s,'End-to-end workflow automation and private AI systems built around your operations.',70,422,460,112,{size:25,color:'#D9E3EF',leading:1.18});
 image(s,logoBytes,70,568,276,57,'HashCase logo','contain');
 text(s,'CLIENT CAPABILITIES  /  SEPTEMBER 2026',70,653,510,18,{font:HEAD,size:13,bold:true,color:'#B1BDCD'});
 note(s,'HashCase client capabilities. Cover photograph: original image generated for this presentation.');
}
// 02 — executive promise
{
 const s=slide(C.navy);label(s,'The opportunity',2,true);
 text(s,'From scattered inputs\nto approved outcomes.',70,121,1090,170,{font:HEAD,size:62,bold:true,color:C.white,leading:1.0});
 text(s,'HashCase designs the complete path from source material to a finished, reviewable business result.',72,325,1020,76,{size:28,color:'#CEDBEC',leading:1.16});
 const items=[['READ THE WORK','Documents, audio, images and connected systems'],['APPLY JUDGMENT','Grounded models, rules and staff review'],['FINISH THE TASK','Approved outputs, records and actions']];
 items.forEach((a,i)=>{const x=70+i*385;line(s,x,475,x+343,475,i===0?C.blue:i===1?C.violet:C.gold,5);text(s,a[0],x,500,343,25,{font:HEAD,size:18,bold:true,color:C.white});text(s,a[1],x,538,338,62,{size:20,color:'#C4D2E3',leading:1.12});});
 footer(s,2,true);note(s,'Summary based on the HashCase Executive Note, deliverables/HashCase_Executive_Note.docx.');
}
// 03 — illustrative client scenario
{
 const s=slide();label(s,'A workflow you already run',3);title(s,'Five tools to publish one announcement');
 text(s,'A decision is approved at 11 a.m. and must be public, in two languages, by evening.',72,190,1120,37,{size:22,color:C.muted});
 const steps=[['01','ARRIVE','A scanned order, an audio briefing and photos.'],['02','RE-TYPE','Names and figures are copied out by hand.'],['03','VERIFY','Every spelling and number checked by eye.'],['04','WRITE','Marathi, English and social, in separate tools.'],['05','APPROVE','The officer edits and signs; the desk publishes.']];
 steps.forEach((a,i)=>{const x=70+i*233;card(s,x,271,213,245,i===4?C.paleBlue:C.white);text(s,a[0],x+18,289,80,31,{font:HEAD,size:25,bold:true,color:i===4?C.blue:C.violet});text(s,a[1],x+18,336,178,30,{font:HEAD,size:19,bold:true,color:C.ink});text(s,a[2],x+18,381,175,103,{size:18,color:C.muted,leading:1.15});if(i<4)text(s,'→',x+214,360,19,35,{font:HEAD,size:26,bold:true,color:C.blue,align:'center'});});
 box(s,70,550,1142,81,C.navy);text(s,'Nothing here is difficult — all of it is manual. Half a day, five tools, and the officer still checks every name by hand.',93,565,1090,52,{font:HEAD,size:22,bold:true,color:C.white,leading:1.1});
 footer(s,3);note(s,'Worked example used throughout the deck: same-day publication of an official announcement in two languages. Illustrative composite of a common communication workflow; not presented as a specific client case study.');
}
// 04 — four gaps
{
 const s=slide();label(s,'Why work gets stuck',4);title(s,'Four gaps behind those five handoffs');
 const a=[
  ['01',"The source can't be read",'Scans and recordings hold the facts. Nothing can search them.'],
  ['02','Nothing checks the facts','Names, designations and figures are verified by eye, one at a time.'],
  ['03','Generic AI, generic copy','Off-the-shelf drafts miss your terms and format, so staff rewrite.'],
  ['04',"The material can't leave",'Unreleased decisions and citizen data cannot go to a public AI.']
 ];
 a.forEach((v,i)=>{const x=70+i*286;card(s,x,236,265,292,i===3?C.navy:C.white);text(s,v[0],x+22,257,65,30,{font:HEAD,size:22,bold:true,color:i===3?C.gold:C.violet});text(s,v[1],x+22,316,215,62,{font:HEAD,size:24,bold:true,color:i===3?C.white:C.ink,leading:1.03});text(s,v[2],x+22,404,216,91,{size:18,color:i===3?'#C8D5E6':C.muted,leading:1.17});});
 text(s,'Each gap has a fix. The value is closing all four inside one run.',70,567,1100,50,{font:HEAD,size:25,bold:true,color:C.blue});
 footer(s,4);note(s,'Each gap maps to a later section: intake (slide 6), grounding and evaluation (slides 6, 10), model tuning (slides 5, 6) and private deployment (slides 8, 9). Categories describe common workflow patterns, not measured prevalence.');
}
// 05 — offerings
{
 const s=slide(C.navy);label(s,'What HashCase builds',5,true);title(s,'Two capabilities. One operating standard.',85,true,51);
 card(s,70,230,543,352,C.navy2);card(s,635,230,575,352,C.navy2);
 box(s,70,230,543,6,C.blue);box(s,635,230,575,6,C.violet);
 text(s,'01',95,260,70,40,{font:HEAD,size:32,bold:true,color:C.blue});
 text(s,'Applied AI\nworkflow automation',95,315,468,100,{font:HEAD,size:36,bold:true,color:C.white,leading:1.0});
 text(s,'Intake → evidence → model and rules → review → approved action',95,448,465,74,{size:22,color:'#CBD8E8',leading:1.12});
 text(s,'02',660,260,70,40,{font:HEAD,size:32,bold:true,color:C.violet});
 text(s,'Private model\ndeployment and tuning',660,315,500,100,{font:HEAD,size:36,bold:true,color:C.white,leading:1.0});
 text(s,'Inference, retrieval, data, logs and lifecycle inside a client-controlled boundary',660,448,510,74,{size:22,color:'#CBD8E8',leading:1.12});
 text(s,'Built as products your team can run, inspect and improve.',71,606,1080,32,{font:HEAD,size:23,bold:true,color:C.gold});
 footer(s,5,true);note(s,'Source: HashCase Executive Note, core offerings and delivery model.');
}
// 06 — automation architecture
{
 const s=slide();label(s,'01  Applied AI workflow automation',6);title(s,'The same announcement, one controlled run');
 text(s,'Every stage has an input, an output, a failure path and a named owner.',71,194,1110,34,{size:22,color:C.muted});
 const a=[
  ['INTAKE','Scan, audio, photos, APIs'],['EXTRACT','OCR, transcript, names, figures'],['GROUND','Facts locked to the source'],
  ['WRITE','Your fine-tuned model drafts'],['REVIEW','Officer edits beside evidence'],['PUBLISH','Marathi, English, social, creatives']
 ];
 a.forEach((v,i)=>{const x=70+i*190;box(s,x,275,168,200,i===4?C.paleBlue:C.white,C.line,5);box(s,x,275,168,7,i<3?C.violet:C.blue);text(s,String(i+1).padStart(2,'0'),x+16,300,45,30,{font:HEAD,size:20,bold:true,color:i<3?C.violet:C.blue});text(s,v[0],x+16,346,145,31,{font:HEAD,size:18,bold:true,color:C.ink});text(s,v[1],x+16,394,143,67,{size:17,color:C.muted,leading:1.12});if(i<5)text(s,'→',x+168,350,22,38,{font:HEAD,size:27,bold:true,color:C.blue,align:'center'});});
 box(s,70,519,1108,90,C.soft);text(s,'Stage 04 runs on a model fine-tuned on your own approved output — the first draft already reads like your department wrote it.',93,537,1058,56,{font:HEAD,size:24,bold:true,color:C.ink,leading:1.1});
 footer(s,6);note(s,'Architecture based on implemented DGIPR intake, grounding, generation, review and job orchestration components. The generation stage uses a model fine-tuned on officer-approved output so drafts follow the department house style. Sources: apps/api/src/jobs/document-intake.ts; packages/content-engine/src/intake; packages/content-engine/src/generation; packages/content-engine/src/finetune.');
}
// 07 — applications
{
 const s=slide();label(s,'Workflows we can build',7);title(s,'Built around your documents, decisions and systems');
 const a=[
  ['DOCUMENT OPERATIONS','PDFs, scans, forms and attachments','Validated fields, review-ready records and exception queues'],
  ['KNOWLEDGE WORK','Approved internal policies and reference material','Sourced answers, reports and reusable institutional knowledge'],
  ['MULTI-SYSTEM OPERATIONS','Requests, business APIs and approval chains','Tracked actions, recovery from partial failure and clear ownership'],
  ['MULTIMODAL PRODUCTION','Audio, notes, images and source documents','Multilingual text and approved visual or video assets']
 ];
 a.forEach((v,i)=>{const y=208+i*104;box(s,70,y,1140,89,i%2===0?C.white:C.soft);box(s,70,y,6,89,i===3?C.violet:C.blue);text(s,v[0],94,y+18,312,32,{font:HEAD,size:20,bold:true,color:C.ink});text(s,v[1],422,y+17,315,56,{size:18,color:C.muted,leading:1.1});text(s,'→',759,y+20,40,35,{font:HEAD,size:24,bold:true,color:C.blue,align:'center'});text(s,v[2],824,y+15,354,62,{size:18,bold:true,color:C.ink,leading:1.11});});
 footer(s,7);note(s,'Client workflow patterns from HashCase Executive Note. These are scope examples rather than claims of identical prior deployments.');
}
// 08 — private AI photo
{
 const s=slide(C.dark);image(s,infraBytes,538,0,742,H,'Private data center engineer inspecting server infrastructure');
 box(s,0,0,570,H,C.dark);label(s,'02  Private AI deployment',8,true);
 text(s,'Your AI stays\ninside your\nboundary.',70,130,475,230,{font:HEAD,size:56,bold:true,color:C.white,leading:0.99});
 text(s,'We deploy inference, retrieval and approved model adaptation in infrastructure you control.',71,400,445,95,{size:25,color:'#D0DDEB',leading:1.16});
 text(s,'Data paths, identity, network egress and logs are specified and tested for the deployment.',71,534,455,67,{size:20,color:'#AFC0D3',leading:1.14});
 text(s,'PRIVATE DEPLOYMENT  /  CLIENT-SPECIFIC DESIGN',71,656,460,18,{font:HEAD,size:12,bold:true,color:C.gold});
 note(s,'Original data center photograph generated for this presentation. Private deployment design comes from HashCase Executive Note and is a proposed offering, not a description of the current DGIPR deployment.');
}
// 09 — boundary architecture
{
 const s=slide();label(s,'Private deployment architecture',9);title(s,'A data boundary you can inspect');
 text(s,'The exact boundary is mapped to your infrastructure, access model and approved integrations.',71,188,1120,43,{size:22,color:C.muted});
 box(s,70,255,250,309,C.white,C.line,7);text(s,'CLIENT SOURCES',92,279,205,27,{font:HEAD,size:19,bold:true,color:C.violet});
 ['Documents and media','Internal systems','Approved training data','Policies and reference'].forEach((t,i)=>{box(s,91,326+i*49,207,38,C.soft);text(s,t,102,332+i*49,190,26,{size:17,color:C.ink});});
 text(s,'→',327,385,51,45,{font:HEAD,size:34,bold:true,color:C.blue,align:'center'});
 box(s,385,255,555,309,C.navy);text(s,'CLIENT-CONTROLLED ENVIRONMENT',410,278,500,29,{font:HEAD,size:19,bold:true,color:C.gold});
 const blocks=[['MODEL INFERENCE','Selected open-weight models'],['PRIVATE RETRIEVAL','Indexes and grounding'],['ADAPTATION','Approved examples and versions'],['CONTROL PLANE','Identity, logging and rollback']];
 blocks.forEach((v,i)=>{const x=408+(i%2)*256,y=331+Math.floor(i/2)*100;box(s,x,y,230,82,C.navy2);text(s,v[0],x+13,y+13,210,23,{font:HEAD,size:17,bold:true,color:C.white});text(s,v[1],x+13,y+43,210,27,{size:16,color:'#B9C9DB'});});
 text(s,'→',948,385,50,45,{font:HEAD,size:34,bold:true,color:C.blue,align:'center'});
 box(s,1005,255,205,309,C.paleBlue);text(s,'APPROVED\nOUTPUTS',1026,279,165,62,{font:HEAD,size:20,bold:true,color:C.ink,leading:1.0});
 ['Reviewed answers','System actions','Exportable records','Audit evidence'].forEach((t,i)=>text(s,'• '+t,1026,364+i*42,166,32,{size:17,color:C.ink}));
 box(s,70,590,1140,48,C.lavender);text(s,'Unapproved external model calls are blocked by policy when the agreed private boundary requires it.',89,599,1100,32,{font:HEAD,size:19,bold:true,color:C.ink});
 footer(s,9);note(s,'Conceptual reference architecture based on HashCase Executive Note, private deployment section. Actual security controls, data flow and egress policy require client-specific design and verification.');
}
// 10 — evaluation
{
 const s=slide();label(s,'Evaluation and assurance',10);title(s,'Quality is tested at every layer');
 const a=[
  ['01','PROGRAMMATIC','Schemas, identifiers, numbers and safe state transitions'],
  ['02','CONTENT','Source coverage, claim support, language rubrics and terminology'],
  ['03','TRAJECTORY','Tool choices, arguments, loops and final system state'],
  ['04','FAILURE CASES','Conflicts, malformed inputs, timeouts and recovery'],
  ['05','OPERATIONS','Latency, throughput, task cost and regression after change']
 ];
 a.forEach((v,i)=>{const y=211+i*82;line(s,70,y+73,1210,y+73,C.line,1);text(s,v[0],70,y+10,64,39,{font:HEAD,size:28,bold:true,color:i===4?C.violet:C.blue});text(s,v[1],151,y+10,265,38,{font:HEAD,size:21,bold:true,color:C.ink});text(s,v[2],454,y+8,735,48,{size:20,color:C.muted,leading:1.1});});
 box(s,70,620,1140,40,C.navy);text(s,'The client sees acceptance evidence, release criteria and the rollback path.',85,627,1100,26,{font:HEAD,size:18,bold:true,color:C.white});
 footer(s,10);note(s,'Evaluation categories grounded in HashCase Executive Note and DGIPR code including packages/content-engine/src/generation/verify-coverage.ts and packages/content-engine/src/finetune/eval-model.ts. Thresholds are defined per client workflow.');
}
// 11 — human review
{
 const s=slide();label(s,'Human control',11);title(s,'Keep consequential decisions with your team');
 text(s,'We place approval gates where a wrong fact or outward action would matter.',71,187,1100,42,{size:22,color:C.muted});
 const st=[['01','CORRECT THE SOURCE','Staff inspect extracted text, names and fields before generation.'],['02','REVIEW THE RESULT','The draft carries evidence, exceptions and editable output.'],['03','APPROVE THE ACTION','Publication or system changes follow the client’s authority rules.']];
 st.forEach((v,i)=>{const x=70+i*381;card(s,x,274,359,277,i===2?C.paleBlue:C.white);text(s,v[0],x+22,296,60,36,{font:HEAD,size:27,bold:true,color:i===2?C.blue:C.violet});text(s,v[1],x+22,356,310,39,{font:HEAD,size:21,bold:true,color:C.ink});text(s,v[2],x+22,419,304,91,{size:20,color:C.muted,leading:1.14});});
 text(s,'The approval design can differ by task: staff may review every output, only exceptions, or only outward actions.',70,584,1130,48,{font:HEAD,size:21,bold:true,color:C.blue,leading:1.13});
 footer(s,11);note(s,'Based on implemented DGIPR correction and publishing gates, plus configurable client workflow design. The three-step visual is an illustrative pattern.');
}
// 12 — DGIPR proof point
{
 const s=slide();label(s,'Proof from a demanding environment',12);title(s,'Official inputs to reviewed public communication',85,false,46);
 text(s,'For Maharashtra Government DGIPR, HashCase built a Marathi-first platform in production use.',71,188,1130,45,{size:22,color:C.muted});
 box(s,70,253,291,256,C.soft);text(s,'SOURCE MATERIAL',91,274,243,28,{font:HEAD,size:19,bold:true,color:C.violet});
 ['Official notes and resolutions','Audio and scanned documents','Video source material'].forEach((t,i)=>text(s,'• '+t,91,325+i*53,245,40,{size:18,color:C.ink}));
 text(s,'→',371,354,42,44,{font:HEAD,size:31,bold:true,color:C.blue,align:'center'});
 box(s,425,253,426,256,C.navy);text(s,'HASHCASE WORKFLOW',447,274,380,28,{font:HEAD,size:19,bold:true,color:C.gold});
 [['INTAKE','Extraction and entity review'],['GROUNDING','Official facts, separate style references'],['PRODUCTION','Generation, validation and officer edits']].forEach((v,i)=>{text(s,v[0],447,322+i*55,130,27,{font:HEAD,size:16,bold:true,color:C.white});text(s,v[1],582,320+i*55,245,39,{size:17,color:'#C7D5E5'});});
 text(s,'→',860,354,42,44,{font:HEAD,size:31,bold:true,color:C.blue,align:'center'});
 box(s,914,253,296,256,C.paleBlue);text(s,'REVIEWED OUTPUTS',935,274,253,28,{font:HEAD,size:19,bold:true,color:C.blue});
 ['Marathi articles','Translations','Branded creatives','Explainer videos'].forEach((t,i)=>text(s,'• '+t,935,317+i*42,250,34,{size:18,color:C.ink}));
 box(s,70,538,1140,71,C.white,C.line,5);text(s,'Safeguards include tracked jobs, verified names and terminology, source checks, schema rules and officer approval.',88,549,1097,52,{font:HEAD,size:21,bold:true,color:C.ink,leading:1.12});
 text(s,'Current DGIPR workflows use approved external AI services for several tasks. Private deployment is a separate offering.',71,621,1126,27,{size:15,color:C.muted});
 footer(s,12);note(s,'Sources: docs/CASE_STUDY.md; AGENTS.md current phase; apps/api/src/jobs/document-intake.ts; packages/content-engine/src/generation/generate-article.ts; packages/content-engine/src/generation/verify-coverage.ts; HashCase Executive Note. Current DGIPR architecture uses external AI providers in several flows and is not represented as on-prem.');
}
// 13 — first engagement
{
 const s=slide();label(s,'A practical start',13);title(s,'Start with one high-value workflow');
 text(s,'We agree on the work to automate, the data boundary and the evidence required before expansion.',71,190,1120,56,{size:22,color:C.muted,leading:1.12});
 const a=[['01','MAP','Source systems, decisions, handoffs and cost of errors','Workflow map + acceptance cases'],['02','BUILD','Intake, model, rules, review and integration in a working pilot','Usable interface + connected pipeline'],['03','PROVE','Representative and edge cases against the current baseline','Evaluation record + failure modes'],['04','OPERATE','Logging, versioning, rollback and ownership','Release plan + handover']];
 a.forEach((v,i)=>{const x=70+i*286;card(s,x,277,265,290,i===3?C.paleBlue:C.white);text(s,v[0],x+20,295,65,38,{font:HEAD,size:27,bold:true,color:i===3?C.blue:C.violet});text(s,v[1],x+20,351,222,35,{font:HEAD,size:24,bold:true,color:C.ink});text(s,v[2],x+20,401,221,82,{size:18,color:C.muted,leading:1.12});line(s,x+20,493,x+244,493,C.line,1);text(s,v[3],x+20,506,223,45,{font:HEAD,size:17,bold:true,color:C.blue,leading:1.07});});
 text(s,'The outcome is a working process and a documented decision on how to scale it.',70,594,1115,36,{font:HEAD,size:23,bold:true,color:C.ink});
 footer(s,13);note(s,'Pilot approach from HashCase Executive Note. Duration, scope, commercial terms and numeric acceptance thresholds are client-specific.');
}
// 14 — close
{
 const s=slide(C.dark);image(s,coverBytes,625,0,655,H,'Editorial operations image from cover');box(s,0,0,635,H,'#000000');
 text(s,'THE NEXT STEP',70,66,520,24,{font:HEAD,size:16,bold:true,color:C.gold});
 text(s,'One workflow.\nEnd to end.\nProven.',70,220,530,210,{font:HEAD,size:60,bold:true,color:C.white,leading:0.99});
 image(s,logoBytes,70,545,310,64,'HashCase logo','contain');
 text(s,'taaha@hashcase.tech   ·   www.hashcase.tech',70,646,530,25,{size:18,color:C.white});
 note(s,'Closing ask: one workflow, a scoped pilot and a measured result. Contact details as supplied by HashCase. Photograph: original generated image for this deck.');
}

await fs.mkdir(path.join(BUILD,'render'),{recursive:true});
for(let i=0;i<pres.slides.length;i++){
  const sl=pres.slides.getByIndex(i);
  const png=await pres.export({slide:sl,format:'png',scale:1});
  await fs.writeFile(path.join(BUILD,'render',`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
}
const requirements={explicitTotalSlideCount:14,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[]};
await (await PresentationFile.exportPptx(pres)).save(path.join(BUILD,'candidate.pptx'));
const result=await finalizePresentation({
  ...requirements,workspaceDir:WORKSPACE,candidatePath:path.join(BUILD,'candidate.pptx'),finalPath:OUT,
  pythonExecutable:PYTHON,
  integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],
  fontPolicy:{basis:'design',families:[FONT,HEAD]},verifyArtifactToolImport:true,
  receiptPath:path.join(BUILD,'validation-client.json')
});
console.log(JSON.stringify({out:OUT,result},null,2));
