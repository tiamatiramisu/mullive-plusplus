// node release.mjs <version>   예) node release.mjs 0.2.1
//
// Greasy Fork의 릴리스 웹훅은 릴리스 에셋을 읽지 않는다. 동기화 URL의 파일명을
// 저장소 루트 기준 경로로 해석해 git에서 태그를 체크아웃해 꺼낸다.
// (greasyfork lib/github.rb: file_from_root_for_url → Git.get_contents)
// 따라서 빌드 산출물이 태그된 커밋의 저장소 루트에 있어야 한다.
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';

const ARTIFACT = 'mullive-plusplus.user.js';
const version = process.argv[2];

/** @param {string} msg */
const fail = (msg) => {
  console.error(`오류: ${msg}`);
  process.exit(1);
};

/** @param {string[]} args */
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('버전을 x.y.z 형식으로 주세요. 예: node release.mjs 0.2.1');
if (git(['status', '--porcelain'])) fail('작업 트리에 커밋되지 않은 변경이 있습니다.');
if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('main 브랜치에서만 릴리스합니다.');

const tag = `v${version}`;
if (git(['tag', '-l', tag])) fail(`${tag} 태그가 이미 있습니다.`);

// Greasy Fork는 버전이 감소하면 거부한다. 직전 태그와 비교해 미리 막는다.
const tags = git(['tag', '-l', 'v*']).split('\n').filter(Boolean);
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, '').split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const latest = tags.sort(cmp).at(-1);
if (latest && cmp(tag, latest) <= 0) fail(`${tag}이 직전 태그 ${latest}보다 크지 않습니다.`);

execFileSync('node', ['build.mjs', `--version=${version}`], { stdio: 'inherit' });
copyFileSync(`dist/${ARTIFACT}`, ARTIFACT);

const built = readFileSync(ARTIFACT, 'utf8');
if (!built.includes(`// @version      ${version}`)) fail('산출물의 @version이 요청한 버전과 다릅니다.');

git(['add', ARTIFACT]);
git(['commit', '-m', `release: ${tag}`]);
git(['tag', '-a', tag, '-m', tag]);
git(['push']);
git(['push', '--tags']);

console.log(`\n${tag} 푸시 완료. Actions가 릴리스를 만들고 Greasy Fork 웹훅이 발동합니다.`);
console.log(`확인: gh run list --limit 1 / gh api repos/tiamatiramisu/mullive-plusplus/hooks/671923702/deliveries`);
