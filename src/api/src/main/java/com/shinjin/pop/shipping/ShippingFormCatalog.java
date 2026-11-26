package com.shinjin.pop.shipping;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import synthetic.shipping.ShippingDomain;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

final class ShippingFormCatalog {
    record Info(String packingNumber, LocalDate packingDate, String order, String customerCode, String customer,
                String customerAbbreviation, String itemKindCode, String itemKind, String materialCode, String material,
                String workCenter, String workCenterName, String orderWorker, String productGroup,
                BigDecimal thickness, BigDecimal width, BigDecimal length, BigDecimal orderQty, BigDecimal previous,
                BigDecimal stock, String warehouse, String location) {
        int priority() { return List.of("SA","SL","SS").contains(itemKindCode) ? 0 : 1; }
        List<String> grouping() { return List.of(customerCode,productGroup,Integer.toString(priority())); }
    }
    record FixtureRow(String id,String ref,String factory,String site,String terminal,String lot,String item,
                      BigDecimal quantity,boolean deferred) {
        ShippingDomain.Handoff handoff() {
            return new ShippingDomain.Handoff(id,ref,new ShippingDomain.Scope(factory,site),terminal,lot,item,quantity,deferred);
        }
    }
    record Fixtures(Map<String,Info> plans, List<FixtureRow> handoffs, Map<String,List<String>> carryQueryFixtures) {}

    final Map<String,Info> plans;
    final Map<String,List<String>> carryFixtures;
    final List<FixtureRow> optionalHandoffs;

    ShippingFormCatalog(Resource extra) {
        var base=read(new ClassPathResource("demo/shipping-form.json"));
        carryFixtures = Map.copyOf(base.carryQueryFixtures());
        var map=new java.util.LinkedHashMap<>(base.plans());
        if (extra == null) optionalHandoffs=List.of();
        else {
            var example=read(extra);
            map.putAll(example.plans());
            optionalHandoffs=List.copyOf(example.handoffs());
        }
        plans=Map.copyOf(map);
    }
    private static Fixtures read(Resource resource) {
        try(var in=resource.getInputStream()) {return JsonMapper.builder().build().readValue(in,Fixtures.class);}
        catch(IOException ex) {throw new IllegalStateException("Unreadable shipping fixture",ex);}
    }

    List<ShippingDomain.Snapshot> orderedCandidates(List<ShippingDomain.Snapshot> draft) {
        var customers = new java.util.LinkedHashMap<String,List<ShippingDomain.Snapshot>>();
        for (var row : draft) {
            customers.computeIfAbsent(info(row).customerCode(), ignored -> new java.util.ArrayList<>()).add(row);
        }
        Comparator<ShippingDomain.Snapshot> order = Comparator
                .comparingInt((ShippingDomain.Snapshot row) -> info(row).priority())
                .thenComparing(row -> info(row).productGroup())
                .thenComparing(row -> info(row).materialCode())
                .thenComparing(row -> info(row).priority() == 0 ? info(row).thickness() : BigDecimal.ZERO)
                .thenComparing(row -> info(row).priority() == 0 ? info(row).width() : BigDecimal.ZERO)
                .thenComparing(row -> info(row).priority() == 0 ? info(row).length() : BigDecimal.ZERO)
                .thenComparing(row -> info(row).priority() == 1 ? info(row).packingNumber() : "");
        return customers.values().stream().flatMap(group -> group.stream().sorted(order)).toList();
    }
    // A demo result vector for the two original SP bindings. The deployed SP owns their meaning.
    boolean matchesCarryFixture(String requestedFlag, ShippingDomain.Snapshot row) {
        return carryFixtures.getOrDefault(requestedFlag,List.of()).contains(row.handoff().deferred() ? "DEFERRED" : "REGULAR");
    }
    Info info(ShippingDomain.Snapshot row) {return plans.get(row.handoff().packingRef());}
}