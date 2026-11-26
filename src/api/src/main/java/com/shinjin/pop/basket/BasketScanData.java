package com.shinjin.pop.basket;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import synthetic.basket.BasketDomain.*;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Comparator;

@Component
@Profile("demo")
final class BasketScanData {
    record Source(Map<String,List<String>> goodWarehouses,List<Row> rows) {}
    record Row(String terminal,String warehouse,String orderNo,String detailCode,String quality,PlanKey key,BigDecimal reQty,BigDecimal remainingWork) {}
    record Result(List<PlanKey> keys,String orderNo,String detailCode) {}

    private final Source source;
    private final TerminalSettingsDemoController settings;

    BasketScanData(TerminalSettingsDemoController settings,
                   @Value("${shinjin.demo.basket-scans:classpath:demo/basket-scans.json}") Resource dataset) throws IOException {
        this.settings=settings;
        try(var input=dataset.getInputStream()){
            this.source=JsonMapper.builder().build().readValue(input,Source.class);
        }
    }

    private List<String> warehouses(String terminal,HttpServletRequest request) {
        return settings.pinnedWarehouseRoles(request).map(roles->roles.getOrDefault("good",List.of()))
                .orElseGet(()->source.goodWarehouses().getOrDefault(terminal,List.of()));
    }

    boolean configured(String terminal,HttpServletRequest request) {
        return !warehouses(terminal,request).isEmpty();
    }

    Work masterOrder(String terminal,Work work){
        var p=work.plan();
        var numbers=source.rows().stream().filter(r->r.terminal().equals(terminal) && r.key().equals(p.key()))
                .map(Row::orderNo).distinct().toList();
        if(numbers.size()!=1)return work;
        return new Work(new Plan(p.key(),numbers.get(0),p.orderLine(),p.item(),p.columns()),work.phase(),work.groupId(),work.produced());
    }
    static final Comparator<BigDecimal> NUMBER=Comparator.nullsFirst(Comparator.naturalOrder());
    static final Comparator<Work> MASTER_ORDER=Comparator.<Work,BigDecimal>comparing(w->w.plan().columns()==null?null:w.plan().columns().thickness(),NUMBER)
            .thenComparing(w->w.plan().columns()==null?null:w.plan().columns().width(),NUMBER)
            .thenComparing(w->w.plan().columns()==null?null:w.plan().columns().length(),NUMBER)
            .thenComparing(w->w.plan().key().date()).thenComparingInt(w->w.plan().key().sequence());

    List<PlanKey> refreshMaster(String order,String detail,View view){
        var sourceRows=source.rows().stream().filter(r->r.terminal().equals(view.actor().terminal())).toList();
        if(sourceRows.stream().noneMatch(r->r.remainingWork()!=null))return null; // older fixture did not supply SELECT2_GV1
        var keys=sourceRows.stream().filter(r->r.orderNo().equals(order) && (detail.isEmpty()||detail.equals(r.detailCode()))
                && r.remainingWork()!=null && r.remainingWork().signum()!=0).map(Row::key).collect(java.util.stream.Collectors.toSet());
        return view.work().stream().filter(w->keys.contains(w.plan().key()))
                .map(w->w.plan().key()).toList();
    }

    Reply<Result> scan(String barcode,View view,HttpServletRequest request) {
        String terminal=view.actor().terminal();
        var good=warehouses(terminal,request);
        if(good.isEmpty())return new Reply<>(409,"GOOD_WAREHOUSE_REQUIRED",null);
        if(barcode==null || barcode.length()!=12 && barcode.length()!=16)return new Reply<>(400,"ORDER_BARCODE_LENGTH",null);
        String order=barcode.substring(0,12),detail=barcode.substring(12);
        var candidates=source.rows().stream().filter(row->row.terminal().equals(terminal) && row.warehouse().equals(good.get(0))
                && row.orderNo().equals(order) && (detail.isEmpty() || detail.equals(row.detailCode()))
                && view.work().stream().anyMatch(work->work.plan().key().equals(row.key()))).toList();
        if(candidates.isEmpty())return new Reply<>(404,"ORDER_NOT_FOUND",null);
        var materials=settings.appliedValues(DemoSessionController.requireIdentity(request),request).materials();
        if(candidates.stream().noneMatch(row->materials.contains(row.quality())))return new Reply<>(422,"MATERIAL_NOT_CONFIGURED",null);
        var keys=candidates.stream().filter(row->view.work().stream().anyMatch(work->work.plan().key().equals(row.key())
                && (work.phase()!=Phase.COMPLETED || row.reQty()!=null && row.reQty().signum()!=0))).map(Row::key).distinct().toList();
        if(keys.isEmpty())return new Reply<>(409,"ORDER_FINISHED",null);
        return new Reply<>(200,null,new Result(keys,order,detail));
    }
}
