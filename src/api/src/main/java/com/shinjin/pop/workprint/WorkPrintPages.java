package com.shinjin.pop.workprint;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.*;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import static com.shinjin.pop.workprint.WorkPrintRenderer.*;
import static com.shinjin.pop.workprint.WorkPrintData.*;

final class WorkPrintPages {
    static final float UNIT = .72f;
    // DevExpress exports each of the five original reports at whole PDF points.
    private static final PDRectangle REPORT_PAPER = new PDRectangle(595, 842);
    private static final float HEIGHT = REPORT_PAPER.getHeight() / UNIT;
    private final PDDocument pdf;
    private final Form form;
    private final Layout layout;
    private final WorkPrintCells painter;
    record Section(List<Map<String,String>> rows, Map<String,String> params, boolean drawing) {}
    record Block(Band band, float x, float y, Map<String,String> row, Section section, WorkPrintCells.Growth growth) {}
    private final List<List<Block>> pages = new ArrayList<>();
    private float y;
    private float x;

    WorkPrintPages(PDDocument pdf, WorkPrintFaces font, Form form, Layout layout) {
        this.pdf = pdf;
        this.form = form;
        this.layout = layout;
        painter = new WorkPrintCells(font, form);
    }

    void write(List<Group> groups) throws IOException {
        List<Section> sections = new ArrayList<>();
        for (var group : groups) {
            var rows = group.rows();
            if (rows.isEmpty()) throw new IOException("Empty group");
            int size = form == Form.Multiple ? 7 : rows.size();
            var params = new HashMap<>(group.header());
            params.put("GroupNo", group.number());
            params.put("TotalProdPlanQty", total(rows, "ProdPlanQty"));
            params.put("TotalShippingQty", total(rows, "SHIPPING_QTY"));
            boolean drawing = rows.stream().anyMatch(r -> isDrawing(r.get("FG_USE2")));
            for (int at = 0; at < rows.size(); at += size) {
                params.put("PageTotal", "(" + (at / size + 1) + "/" + ((rows.size()+size-1)/size) + ")");
                sections.add(new Section(rows.subList(at, Math.min(at+size, rows.size())), Map.copyOf(params), drawing));
            }
        }
        for (int i = 0; i < sections.size(); i++) {
            var section = sections.get(i);
            if (form == Form.Multiple && i % 2 == 1)
                y = Math.max(y, HEIGHT / 2);
            else
                newPage();
            int start = pages.size()-1;
            layout(section);
            for (int page = start; page < pages.size(); page++) {
                var footer = layout.bands().get("BottomMargin");
                if (footer.cells().isEmpty()) continue;
                var row = new HashMap<>(section.rows().get(0));
                row.put("page", (page-start+1) + " / " + (pages.size()-start));
                pages.get(page).add(new Block(footer, x, HEIGHT-layout.margins()[3], row, section, new WorkPrintCells.Growth(new TreeMap<>())));
            }
        }
        if (pages.isEmpty()) throw new IOException("Empty report");
        for (var blocks : pages) {
            var page = new PDPage(REPORT_PAPER);
            pdf.addPage(page);
            try (var stream = new PDPageContentStream(pdf, page)) {
                stream.transform(org.apache.pdfbox.util.Matrix.getScaleInstance(UNIT, UNIT));
                for (var block : blocks) painter.draw(stream, HEIGHT, block);
            }
        }
    }

    static boolean isDrawing(String flag) { return flag!=null && ("002".equals(flag.trim()) || "003".equals(flag.trim())); }
    private static String total(List<Map<String,String>> rows, String key) {
        return rows.stream().map(row -> new BigDecimal(row.get(key))).reduce(BigDecimal.ZERO, BigDecimal::add).toPlainString();
    }
    private void newPage() {
        pages.add(new ArrayList<>());
        x = form == Form.Multiple ? 20 : layout.margins()[0];
        y = form == Form.Multiple ? 10 : layout.margins()[2];
    }
    private Block measure(Band band, Section section, Map<String,String> row) throws IOException {
        return new Block(band,x,y,row,section,painter.measure(band,section,row));
    }
    private static float height(Block block) { return block.band().height()+block.growth().total(); }
    private void add(Block block) {
        pages.get(pages.size()-1).add(new Block(block.band(),x,y,block.row(),block.section(),block.growth()));
        y += height(block);
    }

    private void layout(Section section) throws IOException {
        Band headerBand = layout.bands().get("GroupHeader1");
        Band detail = layout.bands().get("Detail1");
        Band footer = layout.bands().getOrDefault("ReportFooter",layout.bands().get("GroupFooter1"));
        var first = section.rows().get(0);
        float limit = HEIGHT - (form == Form.Multiple ? 10 : layout.margins()[3]);
        var header = headerBand == null ? null : measure(headerBand,section,first);
        boolean needsHeader=true;
        for (var row : section.rows()) {
            var line=measure(detail,section,row);
            float withHeader=needsHeader && header!=null ? height(header) : 0;
            if (y+withHeader+height(line)>limit) {
                newPage();
                needsHeader=true;
            }
            if (needsHeader && header!=null) add(header);
            if (y+height(line)>limit) throw new IOException("Detail exceeds a printable page");
            add(line);
            needsHeader=false;
        }
        if (footer!=null) {
            var totals=measure(footer,section,first);
            if (y+height(totals)>limit) {
                newPage();
                // rptMultipleCustomerWorkOrders3 repeats its group header on a totals-only continuation.
                if (form == Form.Multiple && header!=null) add(header);
            }
            if (y+height(totals)>limit) throw new IOException("Footer exceeds a printable page");
            add(totals);
        }
    }
}
