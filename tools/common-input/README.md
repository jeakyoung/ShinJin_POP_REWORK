# 공통 입력 검증

기본 합성 데이터셋을 사용하는 Java 17 Spring demo의 실행 가능한 jar와 Node 22, Chrome을 사용한다. 기존 공용 셸이 포함된 별도 전환본 사본에 코드 패치를 적용한다. 이 디렉터리의 modes.tsx, numeric-modes.html, verify-vite.config.ts 세 파일을 src/web 바로 아래로 복사한다. src/web에서 기존 의존성으로 TypeScript 검사와 검증용 두 진입점 빌드를 실행한다.

```sh
npx --no-install tsc --noEmit -p tsconfig.app.json
npx --no-install vite build --config verify-vite.config.ts
```

전환본 루트에서 실행한다.

```sh
node tools/common-input/verify.mjs src/api/target/shinjin-pop-api-0.1.0-SNAPSHOT.jar src/web/verify-dist
```

기본 Chrome은 Windows 설치 경로다. 다른 설치 경로는 CHROME_PATH에 지정한다. 기존 폴더를 COMMON_INPUT_CAPTURE_DIR에 지정하면 1280×1024 전체 화면과 실제 팝업 영역을 함께 저장한다. 테스트는 루프백의 새 Spring 메모리 프로세스와 격리된 Chrome 프로필을 띄운다. 실제 소모품 화면은 로그인/관리 메뉴를 통과해 수량 편집과 취소, 현재고 상한만 검사한다. 출고·반납 제출은 하지 않는다. 소수·고정길이와 세 스캔 표면은 numeric-modes.html의 별도 호출자에서 검증한다.
