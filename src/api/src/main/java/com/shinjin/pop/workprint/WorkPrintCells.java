package com.shinjin.pop.workprint;

import com.google.zxing.oned.Code128Writer;
import java.awt.Color;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.*;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.state.RenderingMode;
import static com.shinjin.pop.workprint.WorkPrintPages.*;
import static com.shinjin.pop.workprint.WorkPrintRenderer.*;
import com.shinjin.pop.workprint.WorkPrintData.Form;

final class WorkPrintCells {
    private static final Set<String> SHADED = Set.of("S45C","SKD61","SUS303","AL6061G");
    private final WorkPrintFaces faces;
    private final PDType0Font font;
    private final PDType0Font latin;
    private final PDType0Font drawingBold;
    private final PDFont latinMetrics;
    private final Form form;
    private final DecimalFormat quantities = new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(Locale.ROOT));

    WorkPrintCells(WorkPrintFaces faces, Form form) {
        this.faces=faces;
        PDType0Font font=faces.regular(), latin=faces.latin(), drawingBold=faces.bold();
        this.font = font;
        this.form = form;
        this.latin = latin;
        this.drawingBold = drawingBold;
        this.latinMetrics = latin == null && form == Form.Multiple2 ? new PDType1Font(Standard14Fonts.FontName.HELVETICA) : latin;
    }

    private String value(Cell cell, Section section, Map<String,String> row) {
        if ("page".equals(cell.kind())) return row.getOrDefault("page","");
        if (cell.field() == null) return Objects.toString(cell.text(),"");
        String value = (cell.parameter() ? section.params() : row).getOrDefault(cell.field(),"");
        if (cell.parameter() && cell.format() != null && !value.isBlank() && cell.format().contains("#")) {
            var number = new BigDecimal(value);
            return number.signum()==0 && cell.format().contains(";}") ? "" : quantities.format(number);
        }
        return value;
    }
    private static float size(Cell cell) { return (cell.font()==null ? 9.75f : cell.font())/UNIT; }
    private static float width(PDFont face,String text,float size) throws IOException { return face.getStringWidth(text)*size/1000; }
    private boolean latinOrder(Cell c,String text) {
        return form==Form.Multiple2 && "xrTableCell15".equals(c.id()) && text.chars().allMatch(n->n>=32 && n<127);
    }
    private List<String> lines(Cell c,String text,float width,float size) throws IOException {
        if (latinOrder(c,text)) {
            // rptMultipleCustomerWorkOrders2.xrTable7 has 2+2 units at 96dpi; this cell also has a left border.
            float available=width-4f*100f/96f-1f;
            return wrap(latinMetrics,text,Math.max(1,available),size);
        }
        return wrap(font,text,Math.max(1,width-4),size);
    }

    private List<String> wrap(PDFont face,String text, float space, float size) throws IOException {
        var lines = new ArrayList<String>();
        for (var part : text.replace("\r","").split("\n",-1)) {
            String remaining = part;
            while (!remaining.isEmpty() && width(face,remaining,size)>space) {
                int fit=0, preferred=0;
                float used=0;
                while (fit<remaining.length()) {
                    int end=remaining.offsetByCodePoints(fit,1);
                    float next=used+width(face,remaining.substring(fit,end),size);
                    if (next>space && fit>0) break;
                    used=next;
                    char ch=remaining.charAt(fit);
                    fit=end;
                    if (ch=='-' || ch==' ') preferred=fit;
                }
                int cut=preferred>0 ? preferred : fit;
                lines.add(remaining.substring(0,cut).stripTrailing());
                remaining=remaining.substring(cut).stripLeading();
            }
            if (!remaining.isEmpty() || part.isEmpty()) lines.add(remaining);
        }
        return lines;
    }
    // A growing table row shifts following controls; cells spanning the row extend with it.
    record Growth(NavigableMap<Integer,Float> edges) {
        float before(float ordinate) {
            float result=0;
            for (var delta : edges.headMap(Math.round(ordinate*10),true).values()) result+=delta;
            return result;
        }
        float total() { return before(100000); }
    }
    Growth measure(Band band, Section section, Map<String,String> row) throws IOException {
        var growth=new Growth(new TreeMap<>());
        var cells=band.cells().stream().filter(c -> c.kind().equals("text") && !c.fixed())
                .sorted(Comparator.comparingDouble(c -> c.y()+c.h())).toList();
        for (var c : cells) {
            String text=value(c,section,row);
            if (text.isEmpty()) continue;
            float size=size(c), end=c.y()+c.h();
            float available=c.h()+growth.before(end)-growth.before(c.y());
            int lines=lines(c,text,c.w(),size).size();
            float extra=lines*size*1.16f+3-available;
            if (extra>.1f) growth.edges().merge(Math.round(end*10),extra,Float::sum);
        }
        return growth;
    }

    void draw(PDPageContentStream out,float paperHeight,Block block) throws IOException {
        for (var c : block.band().cells()) {
            if (c.drawingMark() && !block.section().drawing()) continue;
            var content=value(c,block.section(),block.row());
            float x=block.x()+c.x();
            float shift=block.growth().before(c.y());
            float top=paperHeight-block.y()-c.y()-shift;
            float height=c.h()+block.growth().before(c.y()+c.h())-shift;
            float bottom=top-height;
            var shadedMaterial=c.id().equals(form==Form.Single ? "xrTableCell23" : "xrTableCell46");
            var shadedItem=(form==Form.Single && c.id().equals("xrTableCell25"))
                    || ((form==Form.Multiple || form==Form.Multiple1) && c.id().equals("xrTableCell15"))
                    || (form==Form.Multiple3 && c.id().equals("xrLabel2"));
            boolean shade=shadedMaterial && SHADED.contains(content) || shadedItem &&
                    (content.equals("SM4면") || form==Form.Multiple && isDrawing(block.row().get("FG_USE2")));
            Color fill=shade ? new Color(211,211,211) : color(c.fill(),null);
            out.saveGraphicsState();
            if (fill!=null) {
                out.setNonStrokingColor(fill);
                out.addRect(x,bottom,c.w(),height); out.fill();
            }
            border(out,c.border(),x,bottom,c.w(),height,c.drawingMark()?2f:.85f);
            out.addRect(x,bottom,c.w(),height); out.clip();
            float size=size(c);
            if ("barcode".equals(c.kind()) && !content.isEmpty()) {
                float caption=c.showText() ? Math.min(height*.4f,size*1.25f) : 0;
                barcode(out,content,x,bottom+caption,c.w(),height-caption);
                if (caption>0) label(out,c,content,x,bottom,c.w(),caption,size,"MiddleCenter",Color.BLACK,false);
            } else if (!content.isEmpty()) {
                label(out,c,content,x,bottom,c.w(),height,size,c.align(),color(c.color(),Color.BLACK),
                        shadedMaterial ? shade : c.bold());
            }
            out.restoreGraphicsState();
        }
    }
    private static Color color(String name,Color fallback) {
        if (name==null || "Transparent".equals(name)) return fallback;
        return switch(name) {
            case "Black" -> Color.BLACK; case "White" -> Color.WHITE;
            case "LightGray" -> new Color(211,211,211); case "Red" -> Color.RED;
            default -> Color.decode(name);
        };
    }
    private static void border(PDPageContentStream out,String spec,float x,float y,float w,float h,float strokeWidth) throws IOException {
        if (spec==null || spec.equals("None")) return;
        out.setLineWidth(strokeWidth);
        if (spec.equals("All")) out.addRect(x,y,w,h);
        else {
            if (spec.contains("Top")) {out.moveTo(x,y+h);out.lineTo(x+w,y+h);}
            if (spec.contains("Bottom")) {out.moveTo(x,y);out.lineTo(x+w,y);}
            if (spec.contains("Left")) {out.moveTo(x,y);out.lineTo(x,y+h);}
            if (spec.contains("Right")) {out.moveTo(x+w,y);out.lineTo(x+w,y+h);}
        }
        out.stroke();
    }
    private void label(PDPageContentStream out,Cell cell,String text,float x,float y,float w,float h,float size,
                       String align,Color color,boolean bold) throws IOException {
        var lines=lines(cell,text,w,size);
        var reservedFace=cell.drawingMark()&&drawingBold!=null?drawingBold:latin!=null&&latinOrder(cell,text)?latin:font;
        float leading=size*1.16f;
        align=Objects.toString(align,"TopLeft");
        float top=align.startsWith("Middle") ? y+(h+leading*lines.size())/2 :
                align.startsWith("Bottom") ? y+leading*lines.size() : y+h;
        float baseline=top-size*.93f;
        out.setNonStrokingColor(color);
        out.setStrokingColor(color);
        out.setLineWidth(size*.025f);
        for (var line : lines) {
            var face=cell.drawingMark() || latinOrder(cell,text) ? reservedFace : faces.select(line,bold);
            float width=width(face,line,size);
            float start=align.endsWith("Center") ? x+(w-width)/2 : align.endsWith("Right") ? x+w-width-2 : x+2;
            out.beginText();
            out.setFont(face,size);
            out.setRenderingMode(bold && !faces.isBold(face) ? RenderingMode.FILL_STROKE : RenderingMode.FILL);
            out.newLineAtOffset(start,baseline);
            out.showText(line);
            out.endText();
            baseline-=leading;
        }
    }
    private static void barcode(PDPageContentStream out,String value,float x,float y,float w,float h) throws IOException {
        boolean[] bits=new Code128Writer().encode(value);
        float module=w/(bits.length+20);
        out.setNonStrokingColor(Color.BLACK);
        for (int i=0;i<bits.length;) {
            if (!bits[i]) {i++;continue;}
            int start=i++;
            while(i<bits.length && bits[i]) i++;
            out.addRect(x+(10+start)*module,y+1,(i-start)*module,h-2);
        }
        out.fill();
    }
}
