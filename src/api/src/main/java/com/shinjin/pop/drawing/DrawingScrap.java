package com.shinjin.pop.drawing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Set;
import synthetic.drawing.DrawingDomain.MaterialReturn;

final class DrawingScrap {
    record Piece(BigDecimal thickness,BigDecimal width,BigDecimal length,BigDecimal quantity) {}
    private static final Set<String> HEAVY=Set.of("033","034","035","036");
    private static final Set<String> LIGHT=Set.of("004","005","006","007","008","009","010");
    private static BigDecimal round(BigDecimal value,int scale) { return value.setScale(scale,RoundingMode.HALF_EVEN); }
    private static BigDecimal weight(List<Piece> rows,BigDecimal density) {
        BigDecimal total=BigDecimal.ZERO;
        for(var r:rows) {
            total=total.add(round(r.thickness().multiply(r.width()).multiply(r.length()).multiply(r.quantity()).multiply(density),4));
        }
        return round(total,1);
    }

    static List<MaterialReturn> receipts(List<DrawingReturnPlaces.ScrapMaster> masters,String grade,
            List<Piece> inputs,List<Piece> products,List<MaterialReturn> returns) {
        if(masters.isEmpty()) return List.of();
        String code=grade==null?"":grade;
        var density=new BigDecimal(HEAVY.contains(code)?"0.008":LIGHT.contains(code)?"0.00276":"0.00785").movePointLeft(3);
        var maxT=inputs.stream().map(Piece::thickness).max(BigDecimal::compareTo).orElse(BigDecimal.ZERO);
        var maxW=inputs.stream().map(Piece::width).max(BigDecimal::compareTo).orElse(BigDecimal.ZERO);
        var crossSection=maxT.multiply(maxW).multiply(density);
        var length=BigDecimal.ZERO;
        var saw=BigDecimal.ZERO;
        for(var p:products){
            length=length.add(p.length().multiply(p.quantity()));
            saw=saw.add(new BigDecimal("2.5").multiply(crossSection).multiply(p.quantity()));
        }
        var good=weight(products,density);
        var powder=round(round(length.multiply(crossSection).subtract(good),4).add(round(saw,4)),1);
        var residue=weight(inputs,density).subtract(good).subtract(powder).subtract(weight(returns.stream()
                .map(r->new Piece(r.thickness(),r.width(),r.length(),r.quantity())).toList(),density));
        return masters.stream().map(m->{
            boolean isPowder=m.thickness()==0 && m.width()==0 && m.length()==0;
            boolean isScrap=m.thickness()==1 && m.width()==1 && m.length()==1;
            return new MaterialReturn(m.warehouse(),m.location(),m.material(),BigDecimal.valueOf(m.thickness()),
                    BigDecimal.valueOf(m.width()),BigDecimal.valueOf(m.length()),isPowder?powder:isScrap?residue:BigDecimal.ZERO);
        }).toList();
    }
}
