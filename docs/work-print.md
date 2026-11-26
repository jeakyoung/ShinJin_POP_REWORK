# 작업지시서 조회와 수동 미리보기

인쇄 메뉴의 **작업지시서**는 `frmWorkPrint`를 연다. 기본 조회는 수주일 오늘부터 오늘까지, 로그인 작업반, 미완료, 미출력, 미종결이다. 조회일은 데모 서버의 로컬 날짜다. 종료일보다 늦은 시작일을 고르면 종료일도 이동하고, 시작일보다 이른 종료일을 고르면 시작일도 이동한다. 수주 담당자 입력 뒤 Enter와 조회 버튼은 같은 조회를 실행한다. 레거시 담당자 입력은 이름 일치 검색이다. 수주번호 직접 조회 입력란은 삭제 스캔 창에 있다.

재질과 계정구분은 개별 행 및 헤더 전체 선택을 지원한다. 저장하면 열린 화면의 조회조건이 바뀌고 조회를 눌러 적용한다. 취소하면 이전 선택을 쓴다. 거래처 선택은 이미 조회한 행을 필터링한다. 그리드의 선택 열은 현재 보이는 행에서 전부 선택됐으면 전부 해제하고 그 외에는 전부 선택한다. 양식에 전달하는 행은 현재 보이는 체크행이며 클릭으로 포커스만 바꾼 행은 포함하지 않는다. 치수는 정수 또는 소수 첫째 자리까지 표시한다.

원본은 Windows 사용자 문서 폴더의 `materialCodes.txt`, `productOptions.txt`를 읽는다. 재질 기본 파일을 최초로 쓸 때의 상대 경로는 읽는 경로와도 다르다. 이번 승인 범위는 화면 내 적용이다. React 화면을 벗어나 다시 열면 합성 기본값을 읽는다. 웹 영속화의 단말·작업자·브라우저 범위는 보류다. 근거는 `POPPRINT/frmWorkPrint.cs` 257–342, 3458–3471, 4040–4053행 및 옵션 폼의 저장 이벤트다.

## 원본과 합성 API

Spring 프로필은 `demo`, 기본 경로는 `/api/pop/work-print`다. 서버가 로그인 세션에서 작업자·단말·공장을 식별한다. 별도 파일 `src/api/src/main/resources/demo/work-print.json`의 사업장과 특수 양식 허용 행은 시험 사례다. 운영 권한표는 미확인이다. 원본 메뉴는 `MainMenu/frmMenu.cs` 456–462, 874–881행, 다섯 버튼은 `COMMON/ComWorkPrintSelect.cs`에 있다. 장수·정남이라는 버튼 문구로 운영 권한을 정할 수 없다. 테스트 키나 작업자를 요청 본문으로 보내서 권한을 부여할 수 없다.

| 요청 | 입력과 결과 | 상태 변경 및 거절 |
|---|---|---|
| GET /options | 오늘, 최초 작업반, 작업반·재질 목록, 세션의 허용 양식, 진단 제출 설정 | 익명 401, 시험 배정 없음 403 |
| POST /search | start/end ISO 날짜, center, complete, printed, closed, drawing, operator, materials 코드 배열, accounts 명칭 배열. 응답은 행 키와 표시 필드 | 공장·사업장 범위, 수주일 양끝 포함, 재질 포함 검사, 생성 담당자 일치, 완료는 출하수량 ≥ 수주수량. 계정 미지정 행은 계정 선택 없이도 표시. 도면가공은 002/003. 조회만 수행 |
| POST /preview | key(UUID), form, rows(선택 행 키 배열). id, pages, device, groups, submitKey 반환 | 서버가 행과 세부 결과 종결을 검사하고 실양식을 메모리 데이터로 렌더. 미선택 400, 미허용 양식 403, 범위 밖 행 404, 종결·요청키 본문 변경 409, 단일 SELECT2 보류 422, 한글 글꼴 또는 PDF 작성 실패 503 |
| GET /preview/{id}/{page} | 현재 세션의 1부터 시작하는 PNG 페이지 | 같은 단말의 다른 세션, 지나간 문서 및 범위 밖 페이지 404 |
| GET /preview/{id}/pdf | 같은 문서의 A4 PDF 전체, inline work-order.pdf | PNG와 동일한 세션 소유권, 닫은 문서 404, 익명 401, 횟수 유지 |
| POST /preview/{id}/close | 빈 객체 | 미리보기 폐기. 출력횟수 유지. 장수·정남에서 미리보기 전에 할당한 그룹은 유지 |
| POST /preview/{id}/submit | 서버가 부여한 submitKey를 key로 전달 | 진단 기능 기본 해제 403. 문서의 Printer1과 현재 등록·적용된 문서 프린터가 맞아야 접수. 미등록 422. 같은 키 재전송은 기존 영수증. 선택 수주행 단위로 횟수 +1 및 합성 원수주 상태 350 |
| POST /delete/scan | barcode 12자, 또는 16자의 앞 12자 | 계획번호로 찾아 서버가 token, number, performance 반환. 없는 번호 404, 길이 오류 400. 조회만 수행 |
| POST /delete/confirm | token, includeResults. 실적이 있으면 두 번째 확인에서만 true | 세션의 스캔 범위를 다시 계산. 범위·확인이 다르면 409. 확정 시 해당 합성 관계행을 한 번에 제거. 같은 확인 재전송은 동일 번호 반환. 원본 화면처럼 목록은 다음 조회에서 갱신 |

원본 조회 호출 `frmWorkPrint.cs` 387–451행의 `SP_POP_ORDER_01_LIST`는 순서대로 FACTORY_CODE, PLANT_CODE, S_DATE, E_DATE, COMPLETE, PRINT_STATE, WORKCENTER_CODE, MATERIAL_CODE, FG_USE, CD_SL, OPMAN, DRAW_ONLY를 받는다. 날짜는 yyyyMMdd, 재질·계정은 CSV, 종결은 Y/N, 도면은 1/0이다. 정렬과 출력상태 조건은 `SQL/FIX_SP_POP_ORDER_01_LIST_20261124.sql` 221–269행을 대조했다. 작업반·재질 마스터는 `SP_POP_ORDER_COMMON` WORKCENTER_LIST, MATERIAL_LIST와 공장·사업장을 사용한다. 웹 fixture는 조회 결과와 필요한 관계만 갖는다. SQL 엔진의 조인·잠금·실행계획이나 현장 설치 버전을 모사하지 않는다.

## 양식별 경계

| 버튼과 분기 | 원본 보고서 | 선택·그룹 규칙 |
|---|---|---|
| 단일 / Single | rptSingleWorkOrders | 선택 행의 수주번호+이력+항번, 계획일+항번을 누적. 원본 938–1048행에서 REPORT_01_LIST의 SINGLE_SELECT2, 0행이면 SINGLE_SELECT3. 단일 A4 양식 |
| PLATE 품목별 바코드X / Multiple | rptMultipleCustomerWorkOrders3, A4MergedReport | 거래처명+재질명+수주번호+거래처 재질분리. 그룹별 7행씩 분할, 전체 그룹에 002/003이 있으면 각 장에 도면 표시. 분할장을 둘씩 A4 상·하 결합. 원본 715, 2405, 2631–2714행 |
| PLATE 품목별 바코드O / Multiple1 | rptMultipleCustomerWorkOrders | 같은 네 개 그룹 필드, 품목 바코드와 그룹 합계. 1163, 1298, 1549–1573행 |
| 물류반 거래처별 장수 / Multiple2 | rptMultipleCustomerWorkOrders2 | 거래처명 단위. 생산예정·출하수량 합계. 일자별 그룹번호 부여. 1725, 1861, 2070–2199행 |
| 물류반 거래처+재질 정남 / Multiple3 | rptMultipleCustomerWorkOrders4 | 거래처명+재질명 단위. 2862, 2998, 3203–3337행 |

묶음 양식의 `SP_POP_COM_REPORT_03_LIST` 호출은 CUSTOMER_MULTIPLE1 제목행과 CUSTOMER_MULTIPLE2 세부행이다. 저장소 정의는 division, factory_code, plant_code, order_no, order_seqno, prodplan_dateseq를 받는다. 상세 조회의 계획 바코드는 계획일+항번, 수량은 수주수량−출하수량이다. 단일 양식의 REPORT_01 호출은 division, factory_code, plant_code, workcenter_code, order_no, order_histno, order_seqno, prodplan_date, prodplan_seq, prodplan_dateseq, order_noseqno 순서다. 마지막 두 값은 선택 행에서 누적한 CSV다. 원본 호출부에서 단일용 workcenter_code 지역 변수의 초깃값은 빈 문자열이다. 단일 SP 내부 결과 계약 전체는 미확인이다.

**단일 양식의 원본 불일치.** 999–1026행은 SELECT2의 결과가 없을 때만 SELECT3을 호출한다. 1029–1036행은 실제 결과 이름과 무관하게 SELECT3 테이블의 CLOSING_FLAG를 읽는다. `COMMON/ComDB.cs` 222–248행은 매 호출 새 DataSet에 지정 이름으로 Fill한다. SELECT2가 행을 반환하는 경로에는 해당 이름의 테이블이 없을 수 있다. 데모 정상 벡터는 SELECT3 결과를 명시한다. 전날 벡터는 SELECT2 결과를 나타내고 미리보기·횟수 변경 전에 422로 멈춘다. 기존 SP 정의와 실제 두 결과셋의 계약을 확인한 뒤 운영에서의 처리를 결정해야 한다.

**시점.** 장수·정남은 `TPR301P`에서 공장·날짜 범위의 P+yyyyMMdd+6자리 그룹번호를 준비하고 해당 선택 상세를 미리보기 전에 bulk copy한다. 다른 양식의 주석 처리된 INSERT는 활성 호출로 세지 않았다. 그룹 할당·미리보기 재전송은 데모 메모리 범위다. 다섯 양식 모두 Printer1 수동 미리보기다. 원본 `EndPrint`가 발생하고 대화상자가 닫힌 뒤에만 `SP_POP_PRINT_CNT_IUD`를 선택 수주행마다 호출한다. 인수는 공장, 수주번호, 이력, 항번, 작업자다. 이어서 POP TSA308 원수주번호·원항번을 읽고 별도 ERP 트랜잭션으로 SA_SOL.CD_USERDEF2=350을 갱신한다. POP와 ERP가 하나의 트랜잭션이라는 근거는 없다. `FIX_SP_POP_PRINT_CNT_IUD_20260930.sql` 파일 머리의 원복 이력과 롤백판의 공장 조건 차이도 운영 연결 전 확인 대상이다.

**삭제.** `COMMON/ComOrderNoScan.cs` 119–170행, `frmWorkPrint.cs` 3473–3924행. 첫 계획일과 같은 번호의 모든 고유 계획항번으로 실적을 찾는다. 실적이 있으면 원수주 확인 후 실적 삭제를 다시 확인한다. TPR601M/T/MT는 생산그룹번호, TPR601LOT/603/601과 TPR301R/301은 계획일·항번, TSA308/307은 수주번호를 사용한다. 실적 분기에서 포장행이 있으면 TSA407L은 출하계획항번, TSA407은 수주번호를 쓴다. 실적 없는 경로는 TPR301R/301과 TSA308/307만 처리한다. 같은 그룹·출하계획항번의 다른 상세도 원본 조건에 들어갈 수 있다. 데모는 추가로 시험 공장·사업장 내부로 제한한다. 원본에서 실적 동반 삭제에 ‘아니오’를 누르면 실제 삭제문을 건너뛰지만 bChk가 true인 채 공통 성공 문구에 도달할 수 있다. 웹 취소는 변경 없이 창을 닫는다.

## 작업지시서 Java PDF 실행

Spring demo 프로필에서 로컬의 임베딩 가능한 한글 TrueType 글꼴 절대 경로를 `shinjin.demo.work-print-font`로 지정한다. JDK 17, PDFBox 3.0.7, ZXing Core 3.5.4를 사용한다. 글꼴 파일은 배포자가 별도로 준비한다. PDF에는 사용한 글리프의 서브셋이 들어간다. 경로 누락, 잘못된 글꼴, 실제 문자의 글리프 누락, 표현 불가능한 바코드는 미리보기 503이다. 문서·특수 그룹·출력횟수 공개는 렌더 성공 뒤 기존 순서를 따른다.

다섯 Designer에서 추출한 밴드·표·셀·필드 배치는 `work-print-layout/*.json`으로 JAR에 포함된다. 각 요청의 선택행으로 PDF 텍스트·선·채움과 Code 128 벡터를 생성한다. 서버는 직렬화한 PDF를 다시 읽어 110 dpi 미리보기 PNG를 만든다. 단일·거래처·재질 그룹의 경계, PLATE 7행 및 상·하 결합, 상세행 줄바꿈과 페이지 반복 머리글을 적용한다. 장수 양식 상세 출하수량의 문자열 0은 표시한다. 출력접수·기기등록은 1차 계약과 같다. 진단 제출은 기본 해제이며 명시적으로 `shinjin.demo.work-print-submit=true`와 단말 Printer1 적용이 필요하다.

`tools/work-print-render`의 C# 소스와 빌드 스크립트는 원본을 비교하는 별도 도구다. JAR의 빌드·기동·미리보기는 이 경로를 참조하지 않는다. `tools/work-print-verify/README.md`에 격리 JAR과 PDF 재검증 명령이 있다. 도구막대 운영 기능·현장 권한표·SELECT2 계약은 보류한다.
