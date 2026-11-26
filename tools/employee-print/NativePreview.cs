using System;
using System.Data;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using DevExpress.XtraReports.UI;
using DevExpress.XtraPrinting;

class NativePreview {
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);

    [STAThread] static void Main(string[] args) {
        var libs = Path.GetFullPath(args[0]);
        AppDomain.CurrentDomain.AssemblyResolve += (s, e) => {
            var f = Path.Combine(libs, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(f) ? Assembly.LoadFrom(f) : null;
        };
        Run(args);
        Environment.Exit(0);
    }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    static void Run(string[] args) {
        Application.EnableVisualStyles();
        var table = new DataTable("OpmanBarCode");
        foreach (var col in new[]{"EMPLOYEE_NO","BASE_NAME","CODE_NAME_FULL","Department_Code","Department_Name","CHK"}) table.Columns.Add(col);
        string[] lines = File.ReadAllLines(args[2]);
        bool encoded = lines.Length > 0 && lines[0] == "EMPLOYEE-ROWS-UTF8-BASE64";
        for (int i = encoded ? 1 : 0; i < lines.Length; i++) {
            string[] cells = lines[i].Split('\t');
            if (encoded) cells = Array.ConvertAll(cells, text => System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(text)));
            table.Rows.Add(cells);
        }
        table.DefaultView.RowFilter = "CHK = 'Y'";
        using (XtraReport report = args[1] == "QR" ? (XtraReport)new REPORT.rptOpmanQR() : new REPORT.rptOpmanBarcode()) {
            report.DataSource = table;
            report.PrinterName = "SYNTHETIC-PRINTER1";
            report.CreateDocument();
            var options = new ImageExportOptions(ImageFormat.Png) { Resolution = 120, ExportMode = ImageExportMode.DifferentFiles };
            report.ExportToImage(args[3], options);
            if (!encoded) using (var memory = new MemoryStream())
            using (var restored = new PrintingSystem()) {
                report.PrintingSystem.SaveDocument(memory);
                memory.Position = 0;
                restored.LoadDocument(memory);
                if (restored.Pages.Count != report.Pages.Count) throw new InvalidDataException("PRNX page count changed");
                Console.WriteLine("Pages=" + report.Pages.Count + " PRNX memory round trip=" + memory.Length);
            }
            if (args.Length < 5) return;
            using (var tool = new ReportPrintTool(report))
            using (var timer = new Timer()) {
                timer.Interval = 1300;
                bool navigated = false;
                timer.Tick += (s, e) => {
                    var f = tool.PreviewForm;
                    if (!f.Visible || !f.IsHandleCreated) return;
                    if (args.Length > 5 && !navigated) {
                        navigated = true;
                        f.SelectedPageIndex = int.Parse(args[5]);
                        return;
                    }
                    timer.Stop();
                    using (var bitmap = new Bitmap(f.Width, f.Height))
                    using (var g = Graphics.FromImage(bitmap)) {
                        var dc = g.GetHdc();
                        try { if (!PrintWindow(f.Handle, dc, 2)) throw new Exception("Preview capture failed"); }
                        finally { g.ReleaseHdc(dc); }
                        bitmap.Save(args[4], ImageFormat.Png);
                    }
                    Console.WriteLine(f.Text + " " + f.Width + "x" + f.Height);
                    DevExpress.XtraBars.BarManager manager = null;
                    for (Type type = f.GetType(); type != null && manager == null; type = type.BaseType)
                        foreach (var field in type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                            if (typeof(DevExpress.XtraBars.BarManager).IsAssignableFrom(field.FieldType))
                                manager = field.GetValue(f) as DevExpress.XtraBars.BarManager;
                    if (manager != null) {
                        var zi = manager.Items["bbiZoomIn"];
                        var zo = manager.Items["bbiZoomOut"];
                        if (zi != null && zo != null) {
                            Console.WriteLine("Initial zoom=" + f.PrintControl.Zoom);
                            for (int i = 0; i < 25; i++) {
                                double before = f.PrintControl.Zoom;
                                zo.PerformClick();
                                if (Math.Abs(before - f.PrintControl.Zoom) < 0.0001) break;
                                Console.WriteLine("ZoomOut=" + f.PrintControl.Zoom);
                            }
                            for (int i = 0; i < 42; i++) {
                                double before = f.PrintControl.Zoom;
                                zi.PerformClick();
                                if (Math.Abs(before - f.PrintControl.Zoom) < 0.0001) break;
                                Console.WriteLine("ZoomIn=" + f.PrintControl.Zoom);
                            }
                        }
                        foreach (DevExpress.XtraBars.Bar bar in manager.Bars) {
                            Console.WriteLine("BAR " + bar.BarName);
                            foreach (DevExpress.XtraBars.BarItemLink link in bar.ItemLinks) {
                                Console.WriteLine(link.Item.Name + " | " + link.Item.Caption + " | " + link.Item.Hint);
                                var menu = link.Item as DevExpress.XtraBars.BarSubItem;
                                if (menu != null) foreach (DevExpress.XtraBars.BarItemLink sub in menu.ItemLinks)
                                    Console.WriteLine("  " + sub.Item.Name + " | " + sub.Item.Caption);
                            }
                        }
                    }
                    Console.Out.Flush();
                    Environment.Exit(0); // isolated capture harness, no operating-system print command
                };
                timer.Start();
                tool.ShowPreviewDialog();
            }
        }
    }
}
