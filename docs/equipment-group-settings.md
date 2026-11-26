# 단말 설비 및 POP 그룹 설정

## 작업자 동선과 원본 근거

| 원본 위치 | 웹에서 확인할 동작 |
|---|---|
| POPSYS/frmSetting.Designer.cs 254–275, 384–406 및 frmSetting.cs 219–230, 295–322, 537–558, 840–861 | 관리 → 단말 설정의 설비 설정(윗줄 네 번째), POP 그룹설정(아랫줄 네 번째). 아이콘·문자·배경 모두 같은 버튼이다. 그룹 타일은 005·105에서만 활성이다. 원본은 사업장/작업장 파일, 공정 파일 순으로 확인한다. 이 단위의 허용된 합성 단말은 공장/공정 초기 설정이 있다. |
| POPSYS/frmMachine.cs 389–455, 509–650, 659–773 | POP ID와 설정설비, 사용/순번/설비코드/설비명/설비명2/POP ID 표. 행 또는 체크 터치, NONE과 다른 설비 상호 배제. 1–6개 선택, 타 단말 설비는 경고 후 확인 가능. 저장 확인 후 기존 매핑 해제와 선택 매핑을 한 번에 반영하고 목록 순서대로 단말 사본을 저장한다. 취소·X·확인 거절은 무변경. |
| POPSYS/frmPopGroup.cs 276–396, 440–624, 657–819 | 시작·종료 열 전체에서 한 칸 선택. 기존 양쪽 자기 ID를 해제하고 선택한 칸에 단말을 지정한다. 반대편 ID·순번 공정·창고는 현재 표시 행을 단말에 복사한다. 저장 후 확인 메시지와 목록 재조회. 그룹 추가는 즉시 반영, 삭제는 확인 후 행과 공정 목록을 제거한다. 바깥 닫기는 미저장 체크만 취소한다. |
| POPSYS/frmProcess2.cs 188–254, 643–717, 732–921 | 그룹 행의 공정설정 → 좌측 공정, 우측 적용 순서와 창고. 추가·더블클릭, 삭제, 위·아래, 창고코드/창고명 팝업. 같은 공정 중복 방지. 한 행 이상이고 각 행의 창고가 정해진 경우에만 확인 후 전체 목록 교체. 내부 저장은 독립적이며 바깥 닫기와 무관하다. |
| COMMON/ComLogin.cs 409–448, 649–677 및 MainMenu/frmMenu.cs 251–274, 510–514, 651–657 | 다음 로그인에서 단말 사본을 적용한다. 일반 설정의 세션 새로고침으로 설비·그룹은 바뀌지 않는다. 005·105는 작업장 메뉴에서 그룹 작업으로 진입하고 정상 설정의 공정·창고 순서를 사용한다. 시작된 작업은 시작 당시 순서로 완료된다. |

설비 매핑(공장/사업장/작업장)과 그룹 레지스트리(공장/사업장), 단말별 설정 사본, 로그인별 적용 사본은 수명이 다르다. 다른 단말이 할당을 넘겨받거나 그룹 행을 지워도 원본 이벤트는 다른 PC의 INI를 수정하지 않는다. 서버의 합성 사본도 같다. 선택 단말이 그룹을 다시 저장할 때 변경된 행 순서를 복사한다. 그룹 역할은 기존 생산 작업의 권한으로 승격하지 않는다. POPREG/frmProcess5.cs 2782 및 4002의 역할 비교는 주석이다.

## Demo API

모든 호출은 기존 세션 쿠키를 사용한다. 기본 경로는 `/api/pop/admin/terminal-settings/{terminalId}/equipment` 이다. GET은 자기 단말의 작업자가 조회하고 PUT은 기존 단말 관리자만 실행한다. 프린터·재질 설정의 버전과 별개로, 동일 공장/사업장의 설비 및 그룹 변경에 공유 버전을 사용한다.

| 요청 | 본문 추가 필드 | 반영 |
|---|---|---|
| GET 기본 경로 | 없음 | version, groupCenter, canEdit, machines(code/name/description/owner), groups(number/start/end/steps), processes, warehouses, saved와 applied(machines/group) |
| PUT /machines | machines 문자열 배열 | 중복·범위·NONE 배타 검사 후 설비 매핑과 로컬 사본 교체 |
| PUT /add | 없음 | 합성 그룹 번호를 생성하여 빈 행 추가 |
| PUT /remove | number | 해당 그룹과 하위 행 삭제 |
| PUT /processes | number, steps 배열. 각 행은 process, warehouse 코드 | 중복·빈 행·미등록 코드 검사 후 순서대로 일괄 교체 |
| PUT /assign | number, side 값 START 또는 END | 자기 기존 역할 해제, 선택 역할 지정 및 단말 사본 저장 |

모든 PUT은 정수 expectedVersion이 필요하다. 성공 200은 GET과 같은 최신 뷰, 버전 충돌 409는 최신 뷰와 기존 값 보존, 잘못된 행·역할·수량은 422, 비로그인은 401, 타 단말·무권한 쓰기·일반 작업장의 그룹 변경은 403이다. 인증 판단과 버전 검사 이후 쓰기 전부를 한 잠금 안에서 처리한다. 그룹 생산의 기존 GET/POST `/api/pop/process-group-demo`는 해당 세션의 적용 순서를 사용한다. 기존 투입 LOT·수량은 로그인 데이터셋에서 온다.

## 합성 경계 및 현장 확인

- 머신 조회 SP_POP_SYS_MACHINE_01_LIST(SELECT, factory_code, plant_code, workcenter_code)는 순번·설비 코드/명/설비명2·기존 POP ID를 반환한다. 저장 이벤트는 tpr151 기존 자기 할당을 정리하고 선택 설비별 새 ID를 지정한 후 INI를 쓴다.
- SP_POP_SYS_POPID_01_LIST(GROUP 또는 GROUP2, factory_code, plant_code, workcenter_code, mainboard_serialno)는 그룹 및 순서 행을 가져온다. SP_POP_ROBOT_GROUP_01_MAX는 출력 MAX_SEQ(int), FORMATTED_POP_GROUP_NO(varchar(3))를 제공한다. 추가·삭제·배정 이벤트의 테이블은 POP_ROBOT_GROUP, POP_ROBOT_GROUP_WORK다.
- SP_POP_SYS_PROCESS_01_LIST(factory_code, plant_code, workcenter_code, SELECT2)는 후보, SP_POP_SYS_POPGROUP_01_LIST(POP_GROUP_NO)는 적용 행, TCO102는 공장/사업장별 창고 코드와 이름을 제공한다. 화면은 선택한 코드 값을 WAREHOUSE_NAME 셀에 놓고 저장 시 WAREHOUSE_CODE 인수로 사용한다. 원본은 SQL 오류 메시지를 표시하며 일부 쓰기의 커밋과 INI 교체는 별개다.
- 이들 SP 정의, 내부 오류 번호, 실제 시퀀스 배정·설치 장치 값은 로컬 SQL 원문에서 확인되지 않았다. 합성 번호는 인메모리 검증용 세 자리 번호다. 설비와 그룹의 생산 DB·INI 영속화, 메인보드 수집은 현장 연결 결정 대상이다.
- 원본 로그인 전 설정 파일 점검은 SJ_SM/frmLogin.cs 166–224, 328–337, 382에 있다. 현재 웹의 로그인 전 단말 선택·사원인증 계약은 기존대로 유지한다. 기존 메뉴에서 원본 ‘로봇’은 ‘그룹 작업’으로 표시되고 일반 작업장에서는 숨겨진다. 두 작업장의 진입과 일반 작업장의 서버 거절을 검증했다. MainMenu/frmMain.cs 281–430의 설비 이슈 건수·상세 창은 별도 업무다.

## 재현

JDK 17로 전환 레포 Java 원본을 컴파일하고 리소스와 JDBC 드라이버가 없는 demo 의존성으로 클래스패스를 구성한다. src/web에서 `npm run build`, `npm run lint -- src`를 실행한다. 저장소 루트에서 다음 명령은 새 demo 인스턴스를 케이스별로 127.0.0.1에 띄운다.

```text
python tools/equipment-settings/verify.py --classpath "<classes>;<resources>;<demo-libs>/*" --java "<jdk>/bin/java.exe" --chrome "<chrome>/chrome.exe" --artifacts "<qa-directory>"
```

tools/equipment-settings/demo-centers.json은 이 검증 전용 005·105·일반 작업장 데이터다. 기본 데이터셋과 기존 대체 데이터는 유지한다. verify-http.py는 서로 다른 쿠키로 동시 저장과 거절 후 불변을, verify-touch.mjs는 실제 Chrome 터치로 설정 세 화면과 재로그인 후 그룹 업무를 검증한다.
