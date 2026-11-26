# 출하 거래명세서 출력 기능 및 API (demo)

## 작업자 동선

출하 화면에서 포장 인계 한 건의 작업을 열고 출하 확정을 선택한다. ‘거래명세서 출력’ 체크의 원본 초기값은 Y다. 확인을 취소하면 출하와 출력 모두 그대로다. 성공 시 먼저 출하번호를 발행하고 그 번호로 거래명세서를 생성한다. 수동 화면을 열지 않고 등록된 합성 Printer2에 종이 대상 페이지만 전달한다. 출력 실패는 이미 저장한 출하를 취소하지 않는다. 이미 발행한 번호의 수동 인쇄로 복구할 수 있다.

확정 행의 ‘인쇄’는 해당 출하번호의 수동 미리보기를 연다. 인쇄를 누르면 현재 화면의 번호에 해당하는 문서를 다시 검증하고 공통 계약의 printFromPreview를 호출한다. 닫기·PDF 다운로드·미리보기 자체는 장치 호출과 재출력 횟수를 늘리지 않는다. 미리보기 이후 적용 Printer2가 달라졌으면 다시 미리보기를 열어야 한다. 수동 인쇄는 거래처의 자동 발송 구분과 독립적이다.

## 원본 대응

- POPLGS/frmLogistics6.Designer.cs:3101 및 frmLogistics6.cs:2498–2532. 출하 저장 커밋을 마친 후 체크 상태에 따라 출하번호별 autoPrint 또는 autoEmail로 분기한다.
- frmLogistics6.cs:3881–3895, 4129–4140, 4191–4221. 종이/이메일/병행 구분에 따라 렌더한 페이지를 모은 뒤 페이지가 있을 때만 Printer2.Print를 호출한다. autoPrint의 더존 로그 호출은 페이지 검사 밖에 있다.
- frmLogistics6.cs:4367, 4381, 4679–4706. autoEmail에서도 병행 구분은 종이 대상이다. 이 경로에는 autoPrint의 출력로그 호출이 없다.
- frmLogistics6.cs:3538–3554, 3826–3864. 수동 버튼은 선택한 전표의 페이지를 모아 Printer2 미리보기로 열고 EndPrint에서 번호별 출력로그를 처리한다. 단순 창 닫기는 EndPrint가 아니다.
- 통합 단위는 현재 웹이 지원하는 한 포장 인계/출하번호다. 설치 프린터, 메일, 더존 또는 ERP를 호출하지 않는다. 원본의 복수 전표 일괄 선택 및 여러 고객별 페이지 병합을 웹에서 재현했다는 의미는 아니다. 한 인계에 거래처 하나를 배정하는 Shell demo fixture이고 현재 거래명세서는 한 페이지다. 매수는 드라이버 기본값으로 추정하지 않고 공통 계약의 미지정 상태로 보존한다.

| 체크 | 거래처 PAPER | EMAIL | PAPER_AND_EMAIL | 출력로그 의도 |
|---|---|---|---|---|
| Y / AUTO_PRINT | 종이 | 없음 | 종이 | 정상 처리 뒤 true. 종이가 0장인 정상 분기 포함 |
| N / AUTO_EMAIL | 없음 | 없음 | 종이 | false |
| 수동 인쇄 | 미리보기의 문서 페이지 | 동일 | 동일 | 합성 장치 수락 후 true |

## Spring API

모두 demo 프로필과 기존 로그인 세션을 사용한다. 고객과 발송 구분은 ShippingCustomerFixture에서 계획 키별 합성 고객 등록으로 조회한다. 클라이언트가 고객/발송 구분·장치 이름·페이지 수를 지정해 출력 대상으로 사용할 수 없다. 프린터는 현재 세션에 적용된 출력 역할 shipment다. 실재 장치가 없는 합성 스풀은 JVM 메모리에서만 유지된다.

- POST /api/pop/shipping/commands. 공통 입력은 handoffId, action, expectedVersion, requestId다. CONFIRM에는 printChecked(boolean)를 받는다. 이전 본문처럼 생략하면 폼의 초기 체크값을 사용한다. REPRINT에는 미리보기가 반환한 previewPrinter를 보낼 수 있다. 이 값은 장치 선택이 아니라 변경 감지용이다. CANCEL은 프린터를 호출하지 않는다.
- 성공(200)은 기존 행 필드와 print를 반환한다. 출력 결과에는 mode, status, device, pages, delivery, logIntent가 있다. SUBMITTED는 합성 장치 수락, NO_PAPER는 정상 종이 0장, PRINTER_UNSET은 Printer2 미설정이다. 렌더러의 글꼴·생성 오류 또는 미등록 고객도 출력 실패로 표시한다. CONFIRM 뒤의 실패는 출하 성공 응답에 포함한다. 재출력 횟수는 수동 장치 수락 후 한 번만 증가한다.
- GET /api/pop/shipping/{number}/document 및 /document/pdf. 기존 JSON 미리보기·PDF 다운로드를 유지한다. PDF_READY 미리보기의 X-Preview-Printer 헤더는 적용된 Printer2다.
- GET /api/pop/shipping/{number}/print-jobs. 해당 활성 전표를 조회할 권한으로만 합성 calls와 results를 읽는다. calls는 공통 SyntheticSpool.submit에서만 추가한다. shipment, requestId, device, pages, copies(null이면 미지정)를 반환한다. results는 장치 호출이 없는 실패와 정상 0장도 포함한다. logIntent는 외부 로그 저장 의도이며 실제 저장 결과가 아니다.
- 인증 누락 401, 타 단말·사업장 403, 없는 대상 404, 오래된 revision·변경된 요청 키 재사용·취소 전표 409, 잘못된 명령/미설정 프린터의 수동 인쇄/미리보기 장치 변경 422. 서버는 요청 키, 작업자, 대상, 전체 명령을 대조하고 직렬 처리한다. 성공한 명령 응답 유실 후 같은 키·본문으로 재호출해도 장치에 두 번 전달하지 않는다. 실패한 출하 후속 출력만 되풀이하려고 새 CONFIRM을 보내지 않는다.
- DB 경계: 기존 원문의 커밋과 출력로그 시점만 모델링했다. 기존 프로시저·트리거·함수, DB 연결·조회·쓰기, 메일 전송, OS 장치 접근은 이 구현에 포함하지 않는다.

## 검증한 데이터

합성 Chrome에서 실제 출하 페이지의 체크박스·확정·미리보기·닫기·인쇄·재시도·출하 취소를 조작하고 같은 Spring 서버의 print-jobs와 reprintCount를 대조했다. A 사업장 1번 계획의 미설정 자동출력 실패 후 수동 인쇄 응답을 유실시켜 같은 키로 복구했고 합성 호출은 한 건이었다. A 사업장 9번(PAPER)은 체크 시 한 장, 2번(EMAIL)은 체크 시 0장, B 사업장 1번(PAPER_AND_EMAIL)은 미체크 시에도 한 장을 기록했다. 동시 중복·본문 변조, 이전 미리보기 장치, 타 사업장 및 취소된 전표도 검증했다.
