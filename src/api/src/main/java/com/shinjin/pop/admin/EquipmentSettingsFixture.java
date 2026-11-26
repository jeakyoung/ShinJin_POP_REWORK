package com.shinjin.pop.admin;

import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

/** Isolated demo master data. Identifiers are unrelated to installed machines and POP serial numbers. */
final class EquipmentSettingsFixture {
    record Item(String code, String name) {}
    record Machine(String code, String name, String description) {}
    static final String NONE = "000000";
    static final Map<String, String> PLANTS = Map.of("DEMO-A", "P1", "DEMO-A2", "P1", "DEMO-B", "P2");
    static final List<Item> PROCESSES = List.of(new Item("P01", "합성 절단"), new Item("P02", "합성 검사"), new Item("P03", "합성 포장"));
    static final List<Item> WAREHOUSES = List.of(new Item("W01", "합성 창고 A"), new Item("W02", "합성 창고 B"));
    static final List<Machine> MACHINES = java.util.stream.Stream.concat(
            java.util.stream.Stream.of(new Machine(NONE, "NONE", "설비없음")),
            IntStream.rangeClosed(1, 7).mapToObj(i -> new Machine("M0" + i, "합성 설비 " + i, "검증용 " + i))).toList();

    record Site(String plant, String plantName, String center, String centerName, String description) {}
    static List<Site> sites(String plant, String initialCenter, String initialName) {
        var rows = new java.util.ArrayList<Site>();
        for (String code : List.of(plant, plant + "B")) {
            String name = "합성 사업장 " + code;
            for (String center : List.of("001", "003", "005", "103", "105")) {
                String centerName = center.equals(initialCenter) && code.equals(plant) ? initialName : "합성 작업장 " + center;
                rows.add(new Site(code, name, center, centerName, "검증용 " + center));
            }
        }
        if (rows.stream().noneMatch(r -> r.center().equals(initialCenter)))
            rows.add(new Site(plant, "합성 사업장 " + plant, initialCenter, initialName, ""));
        return List.copyOf(rows);
    }
    static final List<Item> POP_EQUIPMENT = List.of(new Item("POP01", "합성 POP 설비 1"), new Item("POP02", "합성 POP 설비 2"));

    private EquipmentSettingsFixture() {}
}
