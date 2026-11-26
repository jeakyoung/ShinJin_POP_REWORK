package com.shinjin.pop.inventory;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import synthetic.inventory.InventoryDomain.*;

public record InventoryCatalog(Map<String,String> plants, Map<String,String> warehouses, List<Bin> bins,
                               List<Item> items, List<DefaultBin> defaults, List<FixtureStock> stockRows,
                               Map<String,List<String>> inputWarehouses, Map<String,List<String>> auxiliaryWarehouses) {
    public InventoryCatalog {
        stockRows = stockRows == null ? List.of() : List.copyOf(stockRows);
        auxiliaryWarehouses = auxiliaryWarehouses == null ? Map.of() : Map.copyOf(auxiliaryWarehouses);
    }
    public record Bin(Location location, String name) {}
    public record Item(String code, String kind, String qualityCode, String quality,
                       BigDecimal thickness, BigDecimal width, BigDecimal length, Boolean extraMaterial) {
        public Item { extraMaterial = Boolean.TRUE.equals(extraMaterial); }
    }
    public record DefaultBin(String item, Location location) {}
    public record FixtureStock(String site, Lot lot, Location location, BigDecimal quantity) {}

    public InventoryCatalog forView(View view) {
        var locations = Set.copyOf(view.locations());
        var warehousesInScope = locations.stream().map(Location::warehouse).collect(Collectors.toSet());
        var itemCodes = view.balances().stream().map(row -> row.lot().item()).collect(Collectors.toSet());
        return new InventoryCatalog(Map.of(view.actor().site().site(),
                plants.getOrDefault(view.actor().site().site(), view.actor().site().site())),
                warehouses.entrySet().stream().filter(e -> warehousesInScope.contains(e.getKey()))
                        .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)),
                bins.stream().filter(row -> locations.contains(row.location())).toList(),
                items.stream().filter(row -> itemCodes.contains(row.code())).toList(),
                defaults.stream().filter(row -> locations.contains(row.location()) && itemCodes.contains(row.item())).toList(),
                List.of(), inputWarehouses == null
                        ? Map.of(view.actor().terminal(), warehousesInScope.stream().sorted().toList())
                        : scoped(inputWarehouses, view.actor().terminal(), warehousesInScope),
                scoped(auxiliaryWarehouses, view.actor().terminal(), warehousesInScope));
    }

    private static Map<String,List<String>> scoped(Map<String,List<String>> roles, String terminal, Set<String> allowed) {
        return Map.of(terminal, roles.getOrDefault(terminal, List.of()).stream().filter(allowed::contains).toList());
    }
}
