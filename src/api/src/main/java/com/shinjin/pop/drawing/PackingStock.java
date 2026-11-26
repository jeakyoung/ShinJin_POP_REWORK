package com.shinjin.pop.drawing;

import synthetic.drawing.DrawingDomain.Seed;
import synthetic.drawing.DrawingDomain.StockKey;
import tools.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Location detail for the cut-stock seed. These bins partition the domain balance. */
final class PackingStock {
    record Bin(String item, String materialCode, String warehouse, String warehouseName, String location, String locationName,
               BigDecimal qty, boolean auxiliary) {}
    record Candidate(String lot, String item, String warehouse, String warehouseName, String location,
                     String locationName, boolean auxiliary, String material, String kind, BigDecimal thickness,
                     BigDecimal width, BigDecimal length, BigDecimal qty) {}
    private final List<Bin> bins;

    PackingStock() throws IOException {
        try (var in = Objects.requireNonNull(getClass().getResourceAsStream("/demo/packing-stock.json"))) {
            bins = Arrays.asList(JsonMapper.builder().build().readValue(in,Bin[].class));
        }
    }

    List<Candidate> candidates(Seed seed, PackingController.OrderInfo info, Map<StockKey,BigDecimal> balances) {
        var balance = balances.getOrDefault(seed.cutStock(),BigDecimal.ZERO);
        if (balance.signum() <= 0) return List.of();
        var rows = bins.stream().filter(row -> row.item.equals(seed.item())).toList();
        var total = rows.stream().map(Bin::qty).reduce(BigDecimal.ZERO,BigDecimal::add);
        if (total.compareTo(balance) != 0) throw new IllegalStateException("Packing fixture bin quantity mismatch");
        return rows.stream().filter(row -> row.materialCode.equals(info.materialCode())).map(row -> new Candidate(seed.cutStock().lot(),row.item,row.warehouse,row.warehouseName,
                row.location,row.locationName,row.auxiliary,info.material(),info.kind(),info.thickness(),info.width(),
                info.length(),row.qty)).toList();
    }
}
