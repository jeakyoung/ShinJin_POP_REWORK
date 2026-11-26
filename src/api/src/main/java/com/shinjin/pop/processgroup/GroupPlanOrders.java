package com.shinjin.pop.processgroup;

import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;

/** Synthetic work orders belonging to the existing demo group ledger. */
final class GroupPlanOrders {
    record Order(String plan,String barcode,int planned) {}
    record Row(String plan,String barcode,int planned,BigDecimal remaining, BigDecimal previousGood,
               GroupReturnCatalog.Spec spec, String startTime) {
        boolean matches(Row other) {
            return spec.qualityName().equalsIgnoreCase(other.spec.qualityName())
                    && spec.thickness().equalsIgnoreCase(other.spec.thickness())
                    && spec.width().equalsIgnoreCase(other.spec.width())
                    && startTime.equalsIgnoreCase(other.startTime());
        }
    }
    static final List<Order> ORDERS=List.of(new Order("PLAN-A","2026010101",3),
            new Order("PLAN-B","2026010102",4),new Order("PLAN-C","2026010103",2));
    static List<Row> rows(ProcessGroupController.View view){
        var stages=view.setting().stages();
        var first=stages.isEmpty()?null:stages.get(0);
        return ORDERS.stream().map(order->{
            var finished=view.results().stream().filter(r->r.plan().equals(order.plan()) && first!=null &&
                    Objects.equals(Objects.toString(first.processCode(),first.process()),
                            Objects.toString(r.stage().processCode(),r.stage().process())))
                    .map(ProcessGroupController.Entry::good).toList();
            var remaining=BigDecimal.valueOf(order.planned()).subtract(finished.stream().reduce(BigDecimal.ZERO,BigDecimal::add));
            return new Row(order.plan(),order.barcode(),order.planned(),remaining,finished.isEmpty()?null:finished.get(finished.size()-1),
                    view.material()==null ? new GroupReturnCatalog.Spec("","","") : view.material().spec(order.plan()),
                    view.started().contains(order.plan()) ? view.activeInput().startTime() : "");
        }).toList();
    }
}
