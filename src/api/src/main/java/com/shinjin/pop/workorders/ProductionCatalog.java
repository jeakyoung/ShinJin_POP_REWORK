package com.shinjin.pop.workorders;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
@Profile("demo")
public final class ProductionCatalog {
    public record Reason(String code,String name) {}
    public record Terminal(List<String> good,List<String> bad,Map<String,List<String>> locations,List<Reason> reasons,List<String> returns,List<String> issue) {
        public Terminal {
            good=good==null?List.of():List.copyOf(good);bad=bad==null?List.of():List.copyOf(bad);
            locations=locations==null?Map.of():Map.copyOf(locations);reasons=reasons==null?List.of():List.copyOf(reasons);
            issue=issue==null?List.of():List.copyOf(issue);
            returns=returns==null?List.of():List.copyOf(returns);
        }
    }
    record Start(String terminal,LocalDate date,int sequence,Instant time,String group) {}
    record LotSpec(String terminal,String lot,String warehouse,String location,WorkOrderFixtures.MaterialSpec spec) {}
    record Balance(String terminal,LocalDate date,int sequence,java.math.BigDecimal remaining) {}
    record Config(Map<String,Terminal> terminals,List<Start> starts,List<LotSpec> lots,List<Balance> balances) {
        public Config {lots=lots==null?List.of():List.copyOf(lots);balances=balances==null?List.of():List.copyOf(balances);}
    }
    record StockSeed(String terminal,String lot,String warehouse,String location,java.math.BigDecimal quantity) {}
    private final List<StockSeed> stock;
    List<StockSeed> stock(){return stock;}
    private final Config config;
    final GoodProductLocations goodProducts;
    private final TerminalSettingsDemoController settings;

    ProductionCatalog(@Value("${shinjin.demo.process1-production:classpath:demo/process1-production.json}") Resource dataset,
                      TerminalSettingsDemoController settings,@Value("${shinjin.demo.process1-material-stock:}") String stockResource,
                      org.springframework.core.io.ResourceLoader resources, GoodProductLocations goodProducts) throws IOException {
        this.goodProducts = goodProducts;
        if(stockResource.isBlank())stock=List.of();
        else try(var in=resources.getResource(stockResource).getInputStream()){stock=List.of(JsonMapper.builder().build().readValue(in,StockSeed[].class));}
        this.settings=settings;
        try(var in=dataset.getInputStream()){config=JsonMapper.builder().build().readValue(in,Config.class);}
    }
    List<Start> starts(){return config.starts();}
    java.math.BigDecimal remaining(String terminal,WorkOrderFixtures.Summary plan){
        return config.balances().stream().filter(r->r.terminal().equals(terminal)&&r.date().equals(plan.planDate())&&r.sequence()==plan.planSequence())
            .map(Balance::remaining).findFirst().orElse(null);
    }
    WorkOrderFixtures.MaterialSpec spec(String terminal,String lot,WorkOrderFixtures.Position position) {
        return config.lots().stream().filter(r->r.terminal().equals(terminal)&&r.lot().equals(lot)
                && r.warehouse().equals(position.warehouse())&&r.location().equals(position.location())).map(LotSpec::spec).findFirst().orElse(null);
    }
    public Terminal terminal(String key,HttpServletRequest request) {
        var fallback=config.terminals().getOrDefault(key,new Terminal(List.of(),List.of(),Map.of(),List.of(),List.of(),List.of()));
        return settings.pinnedWarehouseRoles(request)
                .map(roles->new Terminal(roles.getOrDefault("good",List.of()),roles.getOrDefault("bad",List.of()),fallback.locations(),fallback.reasons(),roles.getOrDefault("returns",List.of()),roles.getOrDefault("issue",List.of())))
                .orElse(fallback);
    }
}
