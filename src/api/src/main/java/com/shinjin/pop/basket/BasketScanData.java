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

@Component
@Profile("demo")
final class BasketScanData {
    record Source(Map<String,List<String>> goodWarehouses,List<Row> rows) {}
    record Row(String terminal,String warehouse,String orderNo,String detailCode,String quality,PlanKey key,BigDecimal reQty) {}
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
