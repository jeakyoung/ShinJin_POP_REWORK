# 작업지시서 합성 검증

빈 상태로 시작한 루프백 전용 Spring demo 인스턴스마다 한 번 실행한다. 스크립트는 전용 시험 데이터에서 프린터 설정, 출력횟수, 수주삭제를 검증한다. 실제 프린터를 등록하거나 DB를 준비할 필요가 없다. 초기 상태의 별도 인스턴스에서 각 모드를 실행한다.

| 명령 | 준비 조건 | 확인 범위 |
|---|---|---|
| `python http_check.py PORT http OUT` | 한글 글꼴, 합성 제출 설정 true | 401·403·404·409·422, 조회조건, 특수 그룹 생성·재시도, 다섯 보고서, 9행 명시 제출의 중복 억제, 실적 유무별 삭제 |
| `python http_check.py PORT off OUT` | 한글 글꼴 설정, 제출 설정 false | 미리보기와 닫기 허용, 요청 직접 제출 403 |
| `python http_check.py PORT missing OUT` | 한글 글꼴 미설정 | 특수 양식 503, 조회 횟수 변화 없음 |
| `node chrome.mjs PROFILE OUT http://127.0.0.1:PORT web` | 같은 출처에 전체 Vite 빌드와 Spring API를 제공. 새 Chrome 프로필, headless, remote-debugging-port=0, 해당 URL로 시작. 진단 설정 true | 실제 메뉴, 조회·터치·체크행, 재질/계정 저장·취소·재진입, 양식별 브라우저 페이지, 두 단계 삭제 취소 |
| `node chrome.mjs PROFILE OUT http://127.0.0.1:PORT before` | 변경 전 프런트엔드 | 기존 통합 출력 메뉴의 캡처 |

HTTP는 Python 표준 라이브러리, Chrome 제어는 Node 22의 WebSocket과 로컬 DevTools를 사용한다. 브라우저 인수에는 외부 호스트 차단과 백그라운드 네트워크 차단을 적용한다. 계정과 날짜, 호출할 URL은 전용 fixture에 맞춰져 있다. `WorkPrintRemovalCheck.java`는 같은 패키지에서 API 클래스와 함께 컴파일한 뒤 main을 실행한다. 스캔만으로 상태가 바뀌지 않는지와 일자·항번, 그룹·출하계획 공유, 별도 사업장의 범위를 대조한다.


## 실행 JAR 및 PDF 검증

JDK 17과 Python 3를 준비하고 아래 하네스를 이 디렉터리에서 실행한다. 인수는 Spring Boot 실행 JAR, 출력 디렉터리, 로컬 한글 TTF, 한글이 없는 시험 TTF 순서다. 하네스는 매 모드에서 임시 디렉터리에 JAR만 복사하고 자식 JVM의 PATH를 그 디렉터리로 제한한다. 서버는 루프백 임의 포트에 바인드한다. stress는 JAR에 든 합성 첫 행을 확장해 별도 시험 파일을 만든다. recover는 임시 파일에 한해 글꼴을 교체한다.

```text
python java_jar.py DEMO.jar OUT KOREAN.ttf LATIN.ttf
```

http는 9개 선택행과 원본 5개 양식·소유권·닫기·키 충돌, counts는 양식마다 한 행을 미리본 뒤 첫 제출의 응답 본문을 버리고 같은 키로 다시 제출해 한 번 증가하는지 확인한다. off는 진단 해제 403, recover는 누락·손상·한글 없는 글꼴의 503 후 같은 키와 그룹번호, stress는 원본과 대조한 3~28행의 페이지 수를 검사한다.

`WorkPrintPdfCheck.java`를 PDFBox 3.0.7 및 ZXing Core 3.5.4가 포함된 클래스패스로 컴파일한 뒤 출력 디렉터리를 인수로 실행한다. 240 dpi로 PDF를 렌더해 Code 128 값을 복호화한다. 페이지 크기, 한글 텍스트와 글꼴 임베딩, 장수 상세 출하수량 0, 110 dpi 재렌더와 API PNG 픽셀 일치를 검사한다. 이 명령은 실제 인쇄를 제출하지 않는다.
