# 사업장·작업장, 설비, POP ID 설정

설비·그룹 패치 적용본 위의 후속 단위다. 관리 → 단말 설정에서 사업장&작업장, 공정 설정, 설비 설정, POP ID 설정으로 들어간다. 권한은 기존 Spring demo 단말 관리자 판정을 사용한다. 같은 단말의 작업자는 조회할 수 있다.

## 화면과 저장 경계

| 화면 | 원본 근거 | 구현 |
|---|---|---|
| 공장 설정 | POPSYS/frmSetting.Designer.cs 157–178, frmSetting.cs 372–377, frmPlant.cs 70–106, 224–258, 283–435, 446–515 | 상단 공장을 먼저 터치하고 왼쪽 사업장을 선택한다. 작업장은 NONE으로 바뀌고 해당 사업장의 후보가 오른쪽에 나타난다. 상단 작업장을 터치한 후 오른쪽 행을 선택한다. 둘 다 선택해야 저장한다. 초기 상단 표시는 저장값이며 오른쪽 후보는 사업장 행을 터치할 때 조회한다. |
| 공정 설정 | frmProcess.cs 277–309, 322–444, 466–559, 567–777, 783–840 | 원판절단·평단·평면·측면·길이절단·포장 6개 슬롯. 상단 슬롯 → 공정 후보 행으로 배정한다. 강조된 슬롯을 다시 누르면 해당 배정을 해제한다. 005·105의 1~5번은 선택할 수 없다. 후보 선택 없이 저장하거나 모든 배정을 지우면 안내한다. |
| 설비 설정 | frmMachine.cs 389–455, 509–649, 659–773 | 행 또는 체크를 터치해 1~6개 선택한다. 000000/NONE은 단독 사용한다. 타 단말 할당은 경고 확인 뒤 별도 예/아니오를 거친다. 성공하면 표의 순서로 단말 설비 사본을 저장한다. |
| POP ID 설정 | frmSetting.Designer.cs 352–373, frmSetting.cs 807–829, frmPopId.Designer.cs 195–203, frmPopId.cs 100–148, 224–288, 300–421, 455–466 | 공장·공정이 있어야 진입한다. 설비 설정 파일은 이 화면의 선행 조건에 없다. 행 하나를 터치하면 이전 선택이 해제된다. 타 단말 할당 경고 뒤 저장을 확인하면 할당을 옮기고 창을 닫는다. 상단 ID는 LabelControl이다. 레이블에는 메인보드라는 원문이 있으나 실제 이벤트는 첫 Ethernet/Wi-Fi MAC을 넣는다. 웹은 합성 단말 ID를 사용한다. |
| 자료·확인 | frmMaterial.cs 338–350, 383–410, COMMON/ComMessage.cs 44–98, 149–173 | 재질 머리글 사용으로 전체 선택/해제. 빈 목록 저장 시 안내한다. 설정의 확인은 기존 앱의 ComMessage 대응 컴포넌트를 재사용한다. YN은 예/아니오, OK는 확인 또는 2초 경과로 닫힌다. 프린터 전용 폼은 별도 소유다. |

공장·공정·설비의 삭제 구문은 값이 달라졌는지 비교하지 않는다. 같은 값을 저장해도 아래 표를 적용한다.

| 저장한 폼 | 새로 기록 | 무효화하는 단말 사본 | 원본 줄 |
|---|---|---|---|
| frmPlant | 사업장·작업장 코드/이름·설명 | 공정, 설비, POP ID, POP 그룹, 재질, 창고 | frmPlant.cs 462–511 |
| frmProcess | 슬롯 순서별 공정 | 설비, POP ID, 재질 | frmProcess.cs 804–839 |
| frmMachine | 선택 설비와 000002 할당 | 재질 | frmMachine.cs 552–644 |
| frmPopId | POP ID와 000005 할당 | 기존 자기 POP ID 사본을 교체 | frmPopId.cs 340–417 |

공장 저장은 단말의 로컬 설정을 초기화한다. 공유 설비·POP ID 할당, 그룹 원장·하위 공정, 다른 단말의 사본 및 프린터 역할은 보존한다. 설비와 POP ID가 사용하는 할당 종류와 선택 개수도 별개다. 각 저장은 마지막 검증을 통과한 경우 한 임계 구역에서 반영된다. 타 단말이 설비를 인수해도 이전 단말에 이미 저장된 로컬 사본은 유지한다.

## Demo API

기본 경로는 `/api/pop/admin/terminal-settings/{terminalId}`이다. 세션에서 공장·단말·관리자를 판정한다. 클라이언트가 다른 단말이나 임의 공장으로 쓰기 범위를 바꿀 수 없다.

| 호출 | 입력 | 결과 |
|---|---|---|
| GET 기본 경로 | 세션 | 기존 saved/applied 설정, processSelection.groupCenter/codes 및 합성 processNames. codes의 키는 1~6이며 저장 전 기존 데이터셋이 슬롯 위치만 제공하면 값이 빈 문자열이다. |
| GET /equipment | 세션 | site, sites, popRows(code/name/owner), slotCodes, 설비와 그룹 목록, 두 종류의 버전 중 설비 version, saved/applied의 machines/group/popId. |
| PUT /plant | expectedVersion(단말 설정), equipmentVersion(공유 원장), plant, center | 목록에 속하는 사업장/작업장 검증 후 로컬 설정을 위 표대로 초기화한다. 공장 범위는 인증 세션에서 온다. |
| PUT /section/process | expectedVersion, code, slots. 예로 slots가 {"6":"A-CUT"}이면 선택한 후보를 6번에 기록한다. | 빈 값·미등록 코드·범위 밖 슬롯 및 005·105의 잠긴 슬롯 변경을 거절한다. 기존 위치만 알려진 슬롯은 그 자리에서만 미상 값 그대로 보존할 수 있다. 기존 단일 code는 이번 선택 코드와의 호환 필드다. |
| PUT /section/materials 또는 /section/warehouse | expectedVersion과 materials 배열 또는 code | 선택 구역만 저장하여 다른 미설정 항목이 함께 채워지지 않게 한다. 재질 저장은 공정과 설비 설정을 확인한다. |
| PUT /equipment/machines | expectedVersion(공유 원장), machines | 1~6, 중복·NONE·카탈로그 검사, 소유 매핑과 단말 사본 변경, 재질 해제. |
| PUT /equipment/pop-id | expectedVersion(공유 원장), number(선택된 POP 설비 코드, 예 POP01) | 등록된 유형의 단일 설비에 현재 POP ID를 지정한다. POP ID 자체는 요청 본문으로 받지 않는다. |

성공 200, 미인증 401, 타 단말·무권한 403, 버전 충돌 409, 유효하지 않은 설정 422. 설비 변경의 409는 최신 뷰를 반환한다. 공장 화면은 충돌 시 두 조회를 다시 하고 새 선택을 기다린다. 프린터 저장은 다른 설정이 비어도 독립적으로 동작한다. 전체 설정 PUT은 기존 완성된 설정 호출과 호환되며 초기화 후에는 구역별로 복구한다.

## 로그인과 셸

저장 직후 설정 화면은 다음 설정을 계속 편집할 수 있다. 실행 중인 세션의 작업장·설비·그룹·슬롯은 로그인에서 고정한다. 다음 로그인 응답의 terminal.workCenter, workCenterCode, processSlots, groupWork, packingMenu, initialView가 같은 적용 작업장에서 나온다. 공용 App의 슬롯·로봇·포장 타일과 서버의 그룹·포장 진입이 동일한 판정을 사용한다. 기본 설정의 기존 세션 새로고침은 일반 설정의 기존 동작으로 유지한다. 초기화된 창고를 임의의 LOT 투입 창고로 대체하지 않는다. 변경된 사업장에 합성 투입 LOT가 없으면 생산 시작에 필요한 LOT가 비어 있다.

## MSSQL 호출 계약과 확인 범위

- frmPlant.cs 233–254, 378–395의 SP_POP_SYS_PLANT_01_LIST는 factory_code, plant_code, division을 받는다. SELECT1은 사업장 키/표시명, SELECT2는 선택 사업장의 workcenter_code/name/desc를 바인딩한다. 저장 시 공장 설정과 종속 INI를 교체한다.
- frmProcess.cs 287–306의 SP_POP_SYS_PROCESS_01_LIST는 factory_code, plant_code, workcenter_code, SELECT로 후보 작업코드·명·부가값을 제공한다. UI는 인덱스 0–5를 INI 위치 1–6에 쓴다. 샘플 후보 명칭과 슬롯 배정은 테스트 데이터이고 현장 공정표가 아니다.
- frmMachine.cs 397–415의 SP_POP_SYS_MACHINE_01_LIST는 SELECT, factory_code, plant_code, workcenter_code를 받는다. frmPopId.cs 235–255의 SP_POP_SYS_POPID_01_LIST는 SELECT, factory_code, plant_code, workcenter_code, mainboard_serialno를 받는다. 후자는 체크·설비코드/명·현재 할당 ID를 사용한다. 저장 이벤트는 공장·사업장·EQUIP_KIND·자기 ID로 예전 매핑을 풀고 선택된 equip_sys_cd를 갱신한다. 오류 메시지·롤백 경로는 각 저장 이벤트에 있다. DB 트랜잭션과 PC INI 사이의 물리적 원자성을 가정하지 않는다.
- SP 내부 정의·추가 부작용·오류 번호, 설치 단말 MAC-to-POP 매핑과 실제 카탈로그는 검증하지 않았다. 실제 장치 식별·DB·SQL·INI 쓰기는 실행하지 않았다. Spring 재시작 시 demo 메모리는 초기화된다.

## 검증

이전 단위에 포함된 `tools/equipment-settings/verify.py` 명령에 `--suite site`를 추가한다. 기존 suite equipment도 독립된 서버에서 다시 실행한다. site-centers.json은 같은 작업장의 두 단말에서 할당 인수를 검증하고, 별도 공장의 단말에서 포장 권한의 재로그인 경계를 검증한다. 운영 데이터·기본 데이터셋을 변경하지 않는다.
