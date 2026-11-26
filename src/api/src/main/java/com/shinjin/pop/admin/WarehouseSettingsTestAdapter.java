package com.shinjin.pop.admin;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;

/** The catalog contains synthetic data. Passwords never enter the catalog or HTTP response. */
@Component
@Profile("demo & warehouse-test")
final class WarehouseSettingsTestAdapter {
    private final String expected = System.getenv("POP_WAREHOUSE_TEST_PASSWORD");
    private final Map<WarehouseSettings.Area,List<WarehouseSettings.Row>> catalog = new HashMap<>();

    WarehouseSettingsTestAdapter() throws IOException {
        String file = System.getenv("POP_WAREHOUSE_TEST_CATALOG");
        if (file == null || file.isBlank()) return;
        for (String line : Files.readAllLines(Path.of(file), StandardCharsets.UTF_8)) {
            if (line.isBlank() || line.startsWith("#")) continue;
            String[] fields = line.split("\\t", -1);
            if (fields.length != 5 || Arrays.stream(fields).anyMatch(String::isBlank)) throw new IOException("Invalid warehouse fixture row");
            var scope = new WarehouseSettings.Area(fields[0], fields[1], fields[2]);
            var rows = catalog.computeIfAbsent(scope, ignored -> new ArrayList<>());
            if (rows.stream().anyMatch(row -> row.code().equals(fields[3]))) throw new IOException("Duplicate warehouse fixture row");
            rows.add(new WarehouseSettings.Row(fields[3], fields[4]));
        }
    }
    void verify(String value) {
        if (expected == null || expected.isBlank()) throw WarehouseSettings.failure(HttpStatus.SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE");
        if (value == null || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), value.getBytes(StandardCharsets.UTF_8)))
            throw WarehouseSettings.failure(HttpStatus.FORBIDDEN, "SETTINGS_AUTH_FAILED");
    }
    List<WarehouseSettings.Row> rows(WarehouseSettings.Area area) { return List.copyOf(catalog.getOrDefault(area, List.of())); }
}
