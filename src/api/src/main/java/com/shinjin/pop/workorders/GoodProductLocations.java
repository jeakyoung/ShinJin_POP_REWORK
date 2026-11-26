package com.shinjin.pop.workorders;

import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
@Profile("demo")
final class GoodProductLocations {
    record Choice(String code, String name) {}
    record Warehouse(String code, String name, String status, String etc, List<Choice> locations) {}
    record Plan(LocalDate date, int sequence, String orderStatus, String warehouse, String location) {}
    record Source(List<Warehouse> warehouses, List<Plan> plans) {}
    record Dataset(Map<String,Source> terminals) {}
    record Codes(String warehouse, String location, Integer slot) {}
    record Place(String warehouse, String warehouseName, String location, String locationName, String workStatus, String etc) {}
    record View(List<Warehouse> warehouses, Place current, long revision) {}
    record Selection(long revision, String warehouse, String location, String fromWarehouse, String fromLocation) {}

    private final Dataset data;
    private static final Set<String> SUFFIXES = Set.of("C","H","Z","G");
    private static final Source EMPTY = new Source(List.of(), List.of());

    GoodProductLocations(@Value("${shinjin.demo.good-product-locations:classpath:demo/good-product-locations.json}") Resource resource) throws IOException {
        try (var in = resource.getInputStream()) {
            data = JsonMapper.builder().build().readValue(in, Dataset.class);
        }
    }

    List<Warehouse> choices(String terminal, LocalDate date, int sequence, List<String> allowed) {
        var source = data.terminals().getOrDefault(terminal, EMPTY);
        var plan = plan(source, date, sequence);
        return allowed.stream().flatMap(code -> source.warehouses().stream().filter(w -> code.equals(w.code())).limit(1))
                .map(w -> new Warehouse(w.code(), w.name(), status(plan, w), w.etc(), w.locations())).toList();
    }

    Place initial(String terminal, LocalDate date, int sequence) {
        var source = data.terminals().getOrDefault(terminal, EMPTY);
        var plan = plan(source, date, sequence);
        if (plan == null || plan.warehouse() == null || plan.location() == null) return null;
        var choices = choices(terminal, date, sequence, List.of(plan.warehouse()));
        return resolve(choices, new Codes(plan.warehouse(), plan.location(), null), false);
    }

    Place resolve(List<Warehouse> warehouses, Codes codes, boolean retained) {
        var w = warehouses.stream().filter(v -> v.code().equals(codes.warehouse())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("GOOD_LOCATION_INVALID"));
        var location = w.locations().stream().filter(v -> v.code().equals(codes.location())).findFirst();
        if (location.isEmpty() && (!retained || codes.location() == null || codes.location().isBlank()))
            throw new IllegalArgumentException("GOOD_LOCATION_INVALID");
        return new Place(w.code(), w.name(), codes.location(), location.map(Choice::name).orElse(""), w.status(), w.etc());
    }

    private Plan plan(Source source, LocalDate date, int sequence) {
        return source.plans().stream().filter(p -> p.date().equals(date) && p.sequence() == sequence).findFirst().orElse(null);
    }

    private String status(Plan plan, Warehouse warehouse) {
        String suffix = warehouse.status() == null ? "" : warehouse.status();
        return SUFFIXES.contains(suffix) && plan != null && plan.orderStatus() != null ? plan.orderStatus() + suffix : suffix;
    }
}
