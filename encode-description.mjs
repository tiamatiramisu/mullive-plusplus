import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Greasy Fork 추가 정보용 ASCII 변환.
 *
 * Greasy Fork 는 추가 정보를 `PublicHttpFetcher` 로 내려받는데, 그 안이
 * `SsrfFilter.get(...).body.to_s` 다. **Net::HTTP 의 본문은 Content-Type 의 charset 과 무관하게
 * 늘 ASCII-8BIT(BINARY)** 이고, 스크립트 코드에만 있는 `force_encoding(Encoding::UTF_8)` 이
 * 추가 정보 경로에는 없다(`lib/script_importer/base_script_importer.rb`).
 * 그래서 한글이 한 글자라도 들어가면 UTF-8 정규식과 부딪혀
 * `incompatible encoding regexp match` 로 동기화가 통째로 실패한다.
 *
 * URL 을 raw 로 바꾸든 릴리스 에셋으로 두든 소용없다. 바이트가 문제라서다.
 * 그래서 **사람이 읽는 원본과 별개로 전부 숫자 문자 참조로 바꾼 사본**을 만들어 그걸 동기화한다.
 * 브라우저는 실체 참조를 원래 글자로 되돌려 그리므로 보이는 것은 똑같다.
 *
 * 고칠 것은 `description.ko.src.html` 이다. 이 파일이 만드는 쪽은 손대지 않는다.
 */

const SRC = 'description.ko.src.html';
const OUT = 'description.ko.html';

const src = readFileSync(SRC, 'utf8');
// 코드 포인트 단위로 돈다. 서로게이트 쌍이 반으로 갈리면 안 된다.
const ascii = [...src]
  .map((c) => {
    const code = c.codePointAt(0) ?? 0;
    return code < 128 ? c : `&#x${code.toString(16).toUpperCase()};`;
  })
  .join('');

writeFileSync(OUT, ascii);

const nonAscii = [...ascii].filter((c) => (c.codePointAt(0) ?? 0) > 127).length;
if (nonAscii > 0) throw new Error(`ASCII 로 못 바꾼 글자가 ${nonAscii}개 남았다`);
console.log(`${OUT} 생성 (${src.length}자 -> ${ascii.length}바이트, 비 ASCII 0)`);
