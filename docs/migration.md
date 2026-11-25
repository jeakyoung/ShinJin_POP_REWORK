# 백엔드와 DevExpress 출력 전환

## 백엔드

업무 API는 Spring Boot 4.0, Java 17, Microsoft JDBC Driver for SQL Server로 구성합니다. 기존 POP와 ERP 연결을 분리하고 저장 프로시저 인자, 정밀도, 결과 컬럼과 트랜잭션 순서를 업무 단위로 옮깁니다. SQL 연결은 업무에서 요청할 때 열립니다. API 기동과 상태 확인에는 DB 연결이 필요 없습니다.

첫 업무 전환은 로그인·POP 단말 설정·조회입니다. 이후 출력 및 장비를 단말에서 검증하고 일반 생산·도면가공·포장, 출하·공장이송·더존 순으로 확대합니다. 같은 작업장·업무의 쓰기 주체는 한쪽으로 지정합니다.

- [Spring Boot 4.0 시스템 요구 사항](https://docs.spring.io/spring-boot/4.0/system-requirements.html)

## 출력 위험과 선택

기존 REPORT와 POPPRINT는 .NET Framework 4.7.2와 DevExpress XtraReports 23.1.3을 참조합니다. 작업지시서는 typed DataSet, BeforePrint, 거래처별 템플릿, A4 병합 및 A4/A5 양식을 사용합니다. 포장과 출하에는 라벨/QR 및 별도 양식이 있고 작업자 출력에도 바코드/QR이 있습니다. 호출부는 단말 설정의 프린터명과 WinForms 미리보기에 의존합니다.

| 위험 | 확인 기준 |
|---|---|
| 엔진·런타임 호환 | 기존 DLL 직접 참조를 전제로 삼지 않습니다. 지원되는 최신 XtraReports 버전, 라이선스·패키지 접근 및 배포 권한을 확보한 뒤 대표 양식을 먼저 컴파일하고 렌더링합니다. |
| 폰트·배치·페이지 | 한글 폰트, 폰트 포함 가능 여부, 잘림, 줄바꿈, 페이지 수, 거래처별 분기, 묶음·병합 순서를 기존 PDF와 대조합니다. |
| 바코드·라벨 | Code 128·QR 값을 실제 스캐너로 읽고, A4/A5·사용자 지정 용지의 치수, 여백, 방향, 실제 크기(100%)와 드라이버 동작을 확인합니다. |
| 브라우저와 프린터 | PDF 미리보기와 사용자 인쇄를 기본 후보로 검증합니다. 특정 단말 큐 선택·자동 인쇄가 필요한 업무는 현장 Windows 인쇄 경로나 전용 에이전트가 필요할 수 있습니다. 서버 큐와 사용자 PC 큐를 따로 검증합니다. |
| 인쇄 이력 | 기존 인쇄 횟수 트리거 지점과 취소·재시도 규칙을 확인합니다. PDF 생성, 미리보기, 인쇄 요청, 실제 인쇄를 구분하며 미리보기만으로 물리적 출력 성공을 기록하지 않습니다. |
| Linux 렌더링 | Linux로 이동할 때는 DevExpress Drawing의 Skia 구성, 네이티브 패키지, 한글 폰트 및 실제 출력 대조를 추가 검증합니다. |

초기에는 검증된 WinForms 출력 경로를 병행합니다. 첫 이관 후보는 Windows의 별도 .NET DevExpress 렌더러에서 PDF를 생성하고 React에서 미리보는 방식입니다. 리포트 렌더러의 통합 지점은 Spring API에서 호출할 내부 인터페이스로 검토합니다. 초기 렌더러 검증은 기존 단말과 같은 계열의 Windows 폰트·환경에서 시작합니다. 웹 뷰어가 필요한 경우 ASP.NET Core Reporting과 JavaScript 패키지의 버전·라이선스를 함께 검증합니다. JSX나 HTML로 양식을 새로 만드는 방식은 출력 승인 후에 개별적으로 판단합니다.

출력 승인에는 대표 작업지시서·포장·출하·작업자 양식의 기준 PDF와 실물 출력물, 바코드 재판독, 재인쇄·취소 결과가 필요합니다. 현재 기반 코드에서는 DevExpress 실행, PDF 생성, 운영 DB 조회, 실제 프린터 검증을 수행하지 않았습니다.

- [DevExpress 리포트 이관 가이드](https://docs.devexpress.com/XtraReports/405215/common-information/dot-net-and-net-core-support/dot-net-migration-guides/migrate-reports-to-dotnet)
- [DevExpress Reporting .NET 10 지원 릴리스](https://docs.devexpress.com/XtraReports/405279/whats-new/v-25-2-release-notes?v=25.2)
- [웹 인쇄와 PDF 내보내기](https://docs.devexpress.com/XtraReports/404502/web-reporting/common-features/printing?v=25.2)
- [Linux 리포트 요구 사항](https://docs.devexpress.com/XtraReports/404221/common-information/dot-net-and-net-core-support/use-reporting-on-linux)
