# 설비 호출 합성 검증

Java 17 Spring demo와 Node 22, Chrome 설치가 있는 전환본의 독립 사본에서 실행한다. 로그인은 기본 work-history 데이터셋을 사용한다. 설비 슬롯, 호출·조치 사유, 스캔할 사원은 src/api/src/main/resources/machine-call-fixture.json에서 읽는다. 이 하네스는 루프백 서버에서 세션을 만들고 메모리 이력을 처음부터 검증한다.

1. 전환본 루트에서 서버를 기존 Maven 빌드로 패키징한다. 실행 가능한 Spring Boot jar를 사용한다.
2. 이 디렉터리의 browser-entry.tsx를 src/web/machine-entry.tsx로 복사한다. machine-vite.config.ts와 machine-harness.html도 src/web 아래로 복사한다. 세 파일은 독립 검증 진입점이다.
3. src/web에서 기존 lockfile에 맞는 의존성을 설치한 사본으로 아래 두 명령을 실행한다.

```sh
npm run build
npx --no-install vite build --config machine-vite.config.ts
```

4. 전환본 루트에서 실제 jar 이름을 대입한다.

```sh
node tools/machine-calls/verify.mjs src/api/target/shinjin-pop-api-0.1.0-SNAPSHOT.jar src/web/machine-dist
```

Windows용 기본 Chrome 설치 경로와 다른 경우 CHROME_PATH를 지정한다. MACHINE_CAPTURE_DIR에 기존 폴더를 지정하면 1280×800 PNG가 저장된다. 합성 단말 A 로그인 후 같은 세션에서 machine-harness.html의 슬롯을 누른다. 전체 상세창, 복수 사유의 일괄 등록, 오류·취소의 무변경, 담당 사원번호 입력, 이력, 중복 재실행, 두 번째 단말의 범위 거절을 확인한다. 실제 공용 셸에는 이 하네스를 추가하지 않는다.

통합 담당자는 기존 인증 셸의 설비 슬롯/상세 영역이 차지하는 컨테이너에 MachineCalls를 마운트하고 기존 세션 만료 처리를 onSessionExpired에 전달한다. 목록이나 임의 설비 코드를 props로 전달할 필요가 없다. 설비 수리내역 조회 메뉴는 별도 경로다. 원본 소모품 교체의 별도 탭은 해당 업무 연결 시 같은 상세에 맞춘다.
