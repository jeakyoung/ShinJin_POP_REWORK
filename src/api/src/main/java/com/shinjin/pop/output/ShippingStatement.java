package com.shinjin.pop.output;

import java.io.IOException;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import static com.shinjin.pop.output.SyntheticOutput.*;

public final class ShippingStatement {
    private ShippingStatement() {}

    public record Party(String businessNo, String customerName, String presidentName, String address,
                        String businessStatus1, String businessItem1) {
        boolean complete() {
            return businessNo != null && customerName != null && presidentName != null && address != null
                    && businessStatus1 != null && businessItem1 != null;
        }
    }
    public record Detail(String id, String packingRef, String specification, BigDecimal orderQty,
                         BigDecimal shippingQty, BigDecimal orderPrice, BigDecimal orderAmount,
                         BigDecimal vatAmount, String partner, String remark) {}
    public record Document(String oldShippingNo, String outputDate, List<Party> parties, List<Detail> rows) {
        public boolean selects(List<String> ids) {
            return rows != null && rows.stream().noneMatch(java.util.Objects::isNull)
                    && rows.stream().map(Detail::id).toList().equals(ids);
        }

        public boolean matches(List<ShipmentDocument> members) {
            if (oldShippingNo == null || outputDate == null || parties == null || parties.size() != 2
                    || parties.stream().anyMatch(p -> p == null || !p.complete()) || rows == null
                    || rows.isEmpty() || rows.size() != members.size()) return false;
            try { parseDate(outputDate); } catch (java.time.DateTimeException invalid) { return false; }
            for (int i = 0; i < rows.size(); i++) {
                Detail row = rows.get(i);
                ShipmentDocument member = members.get(i);
                if (row == null || !member.packingRef().equals(row.packingRef()) || row.shippingQty() == null
                        || row.shippingQty().compareTo(member.quantity()) != 0 || row.orderQty() == null
                        || row.orderPrice() == null || row.orderAmount() == null || row.vatAmount() == null
                        || row.specification() == null || row.partner() == null || row.remark() == null) return false;
            }
            return true;
        }
    }
    record Cell(float x,float y,float w,float h,String align,float size,String borders,String key,String label,int slot,boolean shaded) {}
    private static String parseDate(String value) {
        return LocalDateTime.parse(value, DateTimeFormatter.ofPattern("uuuuMMddHHmmss").withResolverStyle(java.time.format.ResolverStyle.STRICT))
                .format(DateTimeFormatter.ofPattern("yyyy년 MM월 dd일"));
    }
    private static BigDecimal sum(List<Detail> rows, Function<Detail,BigDecimal> get) {
        return rows.stream().map(get).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
    private static void party(Map<String,String> values, String prefix, Party p) {
        values.put(prefix+"BusinessNo",p.businessNo()); values.put(prefix+"CustomerName",p.customerName());
        values.put(prefix+"PresidentName",p.presidentName()); values.put(prefix+"Address",p.address());
        values.put(prefix+"BusinessStatus1",p.businessStatus1()); values.put(prefix+"BusinessItem1",p.businessItem1());
    }
    static List<PageView> pages(Document doc, Cell[] cells, PDType0Font font) throws IOException {
        var pages = new ArrayList<PageView>();
        var values = new java.util.HashMap<String,String>();
        var format = new DecimalFormat("#,##0.####;#,##0.####",DecimalFormatSymbols.getInstance(Locale.ROOT));
        party(values,"?",doc.parties().get(0)); party(values,"?Sa",doc.parties().get(1));
        values.put("?GizShippingNo",doc.oldShippingNo()); values.put("?OutPutDate",parseDate(doc.outputDate()));
        values.put("?TotalShippingQty",format.format(sum(doc.rows(),Detail::shippingQty)));
        values.put("?TotalMoney",format.format(sum(doc.rows(),Detail::orderAmount).add(sum(doc.rows(),Detail::vatAmount))));
        for (int start=0; start<doc.rows().size(); start+=15) {
            var rows=doc.rows().subList(start, Math.min(start+15,doc.rows().size()));
            values.put("sumSum([DataTable1].[ORDER_QTY])",format.format(sum(rows,Detail::orderQty)));
            values.put("sumSum([DataTable1].[PREV_OUT_QTY])",format.format(sum(rows,Detail::shippingQty)));
            values.put("sumSum([DataTable1].[ORDER_AMOUNT])",format.format(sum(rows,Detail::orderAmount)));
            values.put("sumSum([DataTable1].[VAT_AMOUNT])",format.format(sum(rows,Detail::vatAmount)));
            var texts=new ArrayList<Text>(); var blocks=new ArrayList<Block>();
            for (Cell cell:cells) {
                String text=cell.key().isEmpty()?cell.label():values.get(cell.key());
                if (cell.slot()>=0) {
                    text=cell.slot()<rows.size()?detail(cell.key(),rows.get(cell.slot()),start+cell.slot()+1,format):"";
                }
                draw(cell,text,texts,blocks,font);
            }
            pages.add(new PageView(595.44f,841.68f,List.copyOf(texts),List.copyOf(blocks)));
        }
        return List.copyOf(pages);
    }
    private static String detail(String field, Detail d, int index, DecimalFormat n) {
        return switch(field) {
            case "[DataTable1.IDX]", "[DataTable1].[IDX]" -> Integer.toString(index);
            case "[DataTable1].[MATERIAL_SPEC]" -> d.specification();
            case "[DataTable1].[ORDER_QTY]" -> n.format(d.orderQty());
            case "[DataTable1].[PREV_OUT_QTY]" -> n.format(d.shippingQty());
            case "[DataTable1].[ORDER_PRICE]" -> n.format(d.orderPrice());
            case "[DataTable1].[ORDER_AMOUNT]" -> n.format(d.orderAmount());
            case "[DataTable1].[VAT_AMOUNT]" -> n.format(d.vatAmount());
            case "[DataTable1].[NM_CUST_PARTNER]" -> d.partner();
            case "[DataTable1].[REMARK]" -> d.remark();
            default -> throw new IllegalArgumentException(field);
        };
    }
    private static void draw(Cell c,String text,List<Text> texts,List<Block> rules,PDType0Font font) throws IOException {
        float x=c.x(), y=c.y(), w=c.w(), h=c.h(), line=.55f;
        String ink="#000000";
        if(c.shaded()) rules.add(new Block(x,y,w,h,"#d3d3d3"));
        if(c.borders().contains("L")) rules.add(new Block(x,y,line,h,ink));
        if(c.borders().contains("R")) rules.add(new Block(x+w-line,y,line,h,ink));
        if(c.borders().contains("T")) rules.add(new Block(x,y,w,line,ink));
        if(c.borders().contains("B")) rules.add(new Block(x,y+h-line,w,line,ink));
        if(text==null) throw new IllegalArgumentException("Unknown statement field "+c.key());
        if(text.isBlank()) return;
        String[] lines=text.split("\\R");
        float size=Math.min(c.size(),(h-1)/lines.length);
        for(String s:lines) if(!s.isEmpty()) size=Math.min(size,(w-2)*1000/font.getStringWidth(s));
        float baseline=y+(h-lines.length*size)/2+size*.85f;
        for(String s:lines) {
            float width=font.getStringWidth(s)*size/1000;
            float left=c.align().endsWith("Center")?x+(w-width)/2:c.align().endsWith("Right")?x+w-width-1:x+1;
            if(!s.isEmpty()) texts.add(new Text(left,baseline,size,ink,s));
            baseline+=size;
        }
    }
}
