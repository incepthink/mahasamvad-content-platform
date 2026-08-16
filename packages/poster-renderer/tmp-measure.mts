import sharp from 'sharp';
const f = process.env.LOCALAPPDATA + '/Temp/claude/vid/s0.png';
const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
const px = (x: number, y: number) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
console.log('frame', info.width, 'x', info.height, 'channels', info.channels);
const isCard = (c: number[]) => c[0]! > 235 && c[1]! > 235 && c[2]! > 235;
const xs: number[] = [];
for (let x = 1000; x < info.width; x++) if (isCard(px(x, 100))) xs.push(x);
console.log('y=100 white run:', xs.length ? `${xs[0]}..${xs[xs.length - 1]} (${xs.length}px)` : 'none');
const ys: number[] = [];
for (let y = 0; y < 400; y++) if (isCard(px(1180, y))) ys.push(y);
console.log('x=1180 white run:', ys.length ? `${ys[0]}..${ys[ys.length - 1]} (${ys.length}px)` : 'none');
console.log('expected rect: x 1078..1269, y 10..194');
