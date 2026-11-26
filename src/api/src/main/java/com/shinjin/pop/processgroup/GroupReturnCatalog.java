package com.shinjin.pop.processgroup;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

@Component
@Profile("demo")
public final class GroupReturnCatalog {
    public record Location(String code, String name) {}
    public record Warehouse(String code, String name, boolean scrap, List<Location> locations) {}
    public record DefaultRow(String warehouse, String location) {}
    public record Match(String warehouse, BigDecimal thickness, BigDecimal width, BigDecimal length, String item) {}
    public record Spec(String qualityName, String thickness, String width) {}
    public record Material(String grade, String returnGrade, BigDecimal thickness, BigDecimal width,
                           List<Warehouse> warehouses, List<DefaultRow> defaults, List<Match> matches, Map<String,Spec> orderSpecs) {
        Spec spec(String plan) {
            if (orderSpecs != null && orderSpecs.containsKey(plan)) return orderSpecs.get(plan);
            return new Spec(grade, thickness.toPlainString(), width.toPlainString());
        }

        Material forPlan(String plan) {
            var row = spec(plan);
            return new Material(grade, returnGrade, new BigDecimal(row.thickness()), new BigDecimal(row.width()),
                    warehouses, defaults, matches, orderSpecs);
        }

        Warehouse warehouse(String code) {
            return warehouses.stream().filter(w -> w.code().equals(code)).findFirst().orElse(null);
        }
    }
    public record Data(Map<String,Material> terminals) {}
    private final Data data;

    public GroupReturnCatalog(@Value("${shinjin.demo.group-returns:classpath:demo/group-returns.json}") Resource file) throws IOException {
        try (var in = file.getInputStream()) {
            data = JsonMapper.builder().build().readValue(in, Data.class);
        }
    }

    Material forTerminal(String terminal) { return data.terminals().get(terminal); }
}
