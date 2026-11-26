using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using DevExpress.XtraReports.UI;
using DevExpress.XtraPrinting;

class WorkPrintRender {
    public class Input {
        public string form;
        public List<Group> groups;
    }
    public class Group {
        public string number;
        public List<Dictionary<string,string>> rows;
    }

    [STAThread] static void Main() {
        AppDomain.CurrentDomain.AssemblyResolve += (sender,e) => {
            string path=Path.Combine(Dependencies.Directory,new AssemblyName(e.Name).Name+".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        };
        Console.InputEncoding=new UTF8Encoding(false);
        Console.OutputEncoding=new UTF8Encoding(false);
        Render();
    }

    static XtraReport NewReport(string form) {
        switch(form) {
            case "Single": return new REPORT.rptSingleWorkOrders();
            case "Multiple": return new REPORT.rptMultipleCustomerWorkOrders3();
            case "Multiple1": return new REPORT.rptMultipleCustomerWorkOrders();
            case "Multiple2": return new REPORT.rptMultipleCustomerWorkOrders2();
            case "Multiple3": return new REPORT.rptMultipleCustomerWorkOrders4();
            default: throw new InvalidDataException("Unknown form");
        }
    }

    static void Render() {
        var json=new JavaScriptSerializer { MaxJsonLength=32000000 };
        var input=json.Deserialize<Input>(Console.In.ReadToEnd());
        var pages=new List<string>();
        var parts=new List<XtraReport>();
        foreach(var group in input.groups) {
            var rows=group.rows;
            int size=input.form=="Multiple" ? 7 : rows.Count;
            for(int offset=0;offset<rows.Count;offset+=size) {
                {
                    var report=NewReport(input.form);
                    var table=new DataTable(input.form=="Single"?"DataTable1":"DataTable2");
                    foreach(string k in rows.SelectMany(row=>row.Keys).Distinct())table.Columns.Add(k);
                    foreach(var obj in rows.Skip(offset).Take(size)){
                        var row=table.NewRow();foreach(var kv in obj) row[kv.Key]=kv.Value;
                        table.Rows.Add(row);
                    }
                    var values=new Dictionary<string,string>(rows[0]);
                    values["GroupNo"]=group.number;
                    values["TotalProdPlanQty"]=rows.Sum(row=>decimal.Parse(row["ProdPlanQty"])).ToString();
                    values["TotalShippingQty"]=rows.Sum(row=>decimal.Parse(row["SHIPPING_QTY"])).ToString();
                    values["PageTotal"]=string.Format("({0}/{1})",offset/size+1,(rows.Count+size-1)/size);
                    foreach(var parameter in report.Parameters) {
                        string value;
                        if(values.TryGetValue(parameter.Name,out value))
                            parameter.Value=Convert.ChangeType(value,parameter.Type);
                    }
                    var plate=report as REPORT.rptMultipleCustomerWorkOrders3;
                    if(plate!=null)plate.DrawMark=rows.Any(row=>row["FG_USE2"]=="002"||row["FG_USE2"]=="003");
                    report.RequestParameters=false;
                    report.DataSource=table;
                    report.CreateDocument();
                    if(input.form=="Multiple") parts.Add(report);
                    else { ExportPages(report,pages); report.Dispose(); }

                }
            }
        }
        for(int i=0;i<parts.Count;i+=2) {
            using(var merged=new REPORT.A4MergedReport(parts[i],i+1<parts.Count?parts[i+1]:null)) {
                merged.CreateDocument(); ExportPages(merged,pages);
            }
        }
        foreach(var part in parts)part.Dispose();
        if(pages.Count==0)throw new InvalidDataException("Empty document");
        Console.Write(json.Serialize(pages));
    }
    static void ExportPages(XtraReport report,List<string> pages) {
                    for(int i=0;i<report.Pages.Count;i++) {
                        using(var stream=new MemoryStream()){
                            var options=new ImageExportOptions {
                                Format=System.Drawing.Imaging.ImageFormat.Png, Resolution=110,
                                PageRange=(i+1).ToString(), ExportMode=ImageExportMode.SingleFilePageByPage
                            };
                            report.ExportToImage(stream,options);
                            pages.Add(Convert.ToBase64String(stream.ToArray()));
                        }
                    }
    }
}
