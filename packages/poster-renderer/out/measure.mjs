import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveFfmpeg } from '../dist/video/assemble.js';
const run = promisify(execFile);
const base = 'https://d10xqbwc7l68wy.cloudfront.net/projects/7d675faf-2641-4261-8ac2-bb1fbfd2a2f5';
// emblem width as a fraction of the lockup raster: EMBLEM_TARGET_WIDTH 96 / LOCKUP_WIDTH 160
const EMBLEM_OF_LOCKUP = 96 / 160;
for (const name of process.argv.slice(2)) {
  await run('curl', ['-sL', `${base}/${name}`, '-o', 'out/m.mp4', '--max-time', '120']);
  await run(resolveFfmpeg(), ['-y','-hide_banner','-loglevel','error','-ss','0.5','-i','out/m.mp4','-frames:v','1','out/m.png']);
  const { data, info } = await sharp('out/m.png').raw().toBuffer({ resolveWithObject: true });
  let minX=1e9,maxX=-1,minY=1e9,maxY=-1,n=0;
  for (let y=0;y<Math.floor(info.height/2.5);y++) for (let x=Math.floor(info.width*0.75);x<info.width;x++) {
    const i=(y*info.width+x)*info.channels, r=data[i],g=data[i+1],b=data[i+2];
    if (r>150 && r-b>70 && r-g>25) { n++; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  const emblemW = maxX-minX+1;
  const ratio = emblemW / EMBLEM_OF_LOCKUP / info.width;
  console.log(`${name.padEnd(24)} ${info.width}x${info.height}  emblem ${String(emblemW).padStart(3)}px  =>  baked ratio ~${ratio.toFixed(3)}  (px ${n})`);
}
