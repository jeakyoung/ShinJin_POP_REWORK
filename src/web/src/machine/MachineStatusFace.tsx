// Static labels and initial values from frmMachinInfo.Designer.cs. Demo profile only.
export default function MachineStatusFace() {
  return <>
    <span className="mc-clock">가동시간&nbsp; -</span>
    <div className="mc-status-face" style={{ left: 12, backgroundImage: "url(" + import.meta.env.BASE_URL + "machine-calls/Container_00.png)" }}>
      <span style={{ left: 265, top: 125, width: 40, height: 19, textAlign: "left" }}>%</span>
      <span style={{ left: 265, top: 95, width: 40, height: 19, textAlign: "left" }}>Rpm</span>
      <span style={{ left: 265, top: 65, width: 40, height: 19, textAlign: "left" }}>mm</span>
      <span style={{ left: 3, top: 125, width: 40, height: 19, textAlign: "right" }}>부하</span>
      <span style={{ left: 3, top: 95, width: 40, height: 19, textAlign: "right" }}>속도</span>
      <span style={{ left: 3, top: 65, width: 40, height: 19, textAlign: "right" }}>위치</span>
      <span style={{ left: 159, top: 38, width: 100, height: 19, textAlign: "right" }}>Y축</span>
      <span style={{ left: 18, top: 38, width: 135, height: 19, textAlign: "right" }}>X축</span>
      <span style={{ left: 0, top: 0, width: 305, height: 30, textAlign: "center" }}>스 핀 들</span>
      <span style={{ left: 187, top: 95, width: 72, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 187, top: 125, width: 72, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 159, top: 65, width: 100, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 18, top: 95, width: 135, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 18, top: 125, width: 135, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 42, top: 65, width: 111, height: 19, textAlign: "right" }}>0</span>
    </div>
    <div className="mc-status-face" style={{ left: 329, backgroundImage: "url(" + import.meta.env.BASE_URL + "machine-calls/Container_00.png)" }}>
      <span style={{ left: 265, top: 125, width: 40, height: 19, textAlign: "left" }}>%</span>
      <span style={{ left: 265, top: 95, width: 40, height: 19, textAlign: "left" }}>Rpm</span>
      <span style={{ left: 265, top: 65, width: 40, height: 19, textAlign: "left" }}>mm</span>
      <span style={{ left: 3, top: 125, width: 40, height: 19, textAlign: "right" }}>부하</span>
      <span style={{ left: 3, top: 95, width: 40, height: 19, textAlign: "right" }}>속도</span>
      <span style={{ left: 3, top: 65, width: 40, height: 19, textAlign: "right" }}>위치</span>
      <span style={{ left: 0, top: 0, width: 305, height: 30, textAlign: "center" }}>베드</span>
      <span style={{ left: 49, top: 95, width: 210, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 49, top: 125, width: 210, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 49, top: 65, width: 210, height: 19, textAlign: "right" }}>0</span>
    </div>
    <div className="mc-status-face" style={{ left: 646, backgroundImage: "url(" + import.meta.env.BASE_URL + "machine-calls/Container_00.png)" }}>
      <span style={{ left: 3, top: 125, width: 40, height: 19, textAlign: "right" }}>베드</span>
      <span style={{ left: 3, top: 95, width: 63, height: 19, textAlign: "right" }}>Y축 서보</span>
      <span style={{ left: 3, top: 65, width: 63, height: 19, textAlign: "right" }}>X축 서보</span>
      <span style={{ left: 0, top: 0, width: 305, height: 30, textAlign: "center" }}>에러코드</span>
      <span style={{ left: 49, top: 125, width: 210, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 49, top: 95, width: 210, height: 19, textAlign: "right" }}>0</span>
      <span style={{ left: 49, top: 65, width: 210, height: 19, textAlign: "right" }}>0</span>
    </div>
  </>
}
