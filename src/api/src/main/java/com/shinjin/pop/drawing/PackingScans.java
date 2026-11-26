package com.shinjin.pop.drawing;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** Ordered synthetic result rows for the frmProcess6 list and order/spec scans. */
final class PackingScans {
    record InputRef(String warehouse, String location, String lot) {
        boolean matches(PackingStock.Candidate candidate) {
            return warehouse.equals(candidate.warehouse()) && location.equals(candidate.location()) && lot.equals(candidate.lot());
        }
    }
    record Source(String key, String listBarcode, String orderNo, String qualitySpec, String orderLine,
                  List<InputRef> previousInputs) {}
    record Match(PackingController.Row row, String orderLine, List<PackingStock.Candidate> inputs) {}
    record Result(List<Match> matches, List<String> notices) {}

    private final List<Source> source;

    PackingScans() throws IOException {
        try (var input = Objects.requireNonNull(getClass().getResourceAsStream("/demo/packing-scans.json"))) {
            source = Arrays.asList(JsonMapper.builder().build().readValue(input, Source[].class));
        }
    }

    Result resolve(String barcode, List<String> visibleKeys, List<PackingController.Row> scopedRows,
                   Function<String,List<PackingStock.Candidate>> stock) {
        boolean group = barcode != null && barcode.length() == 15 && barcode.startsWith("P");
        boolean order = barcode != null && barcode.length() == 16 && barcode.charAt(6) == 'S';
        if (!group && !order) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"PACK_SCAN_FORMAT");
        var rows = scopedRows.stream().collect(Collectors.toMap(PackingController.Row::key, Function.identity()));
        var candidates = source.stream().filter(s -> rows.containsKey(s.key()))
                .filter(s -> group ? barcode.equals(s.listBarcode()) :
                        barcode.substring(0,12).equals(s.orderNo()) && barcode.substring(12).equals(s.qualitySpec())).toList();
        if (candidates.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"PACK_SCAN_NOT_FOUND");

        if (order && candidates.stream().noneMatch(s -> rows.get(s.key()).allowedMaterial()))
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"MATERIAL_NOT_ASSIGNED");
        var visible = new HashSet<>(visibleKeys);
        var orderLines = new HashSet<String>();
        for (var s : source) {
            if (rows.containsKey(s.key()) && visible.contains(s.key())) orderLines.add(s.orderLine());
        }
        var matches = new ArrayList<Match>();
        var notices = new LinkedHashSet<String>();
        for (var candidate : candidates) {
            var row = rows.get(candidate.key());
            if (!row.allowedMaterial()) { notices.add("MATERIAL_NOT_ASSIGNED"); continue; }
            if (row.state() == synthetic.drawing.DrawingDomain.State.SHIP_READY) { notices.add("PACK_SCAN_FINISHED"); continue; }
            if (visible.contains(row.key()) || (order && orderLines.contains(candidate.orderLine()))) {
                notices.add("PACK_SCAN_DUPLICATE"); continue;
            }
            var inputs = new ArrayList<PackingStock.Candidate>();
            if (!candidate.previousInputs().isEmpty()) {
                var bins = stock.apply(row.key());
                for (var input : candidate.previousInputs()) {
                    inputs.add(bins.stream().filter(input::matches).findFirst()
                            .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT,"INVALID_PACKING_STOCK")));
                }
            }
            visible.add(row.key());
            orderLines.add(candidate.orderLine());
            matches.add(new Match(row,candidate.orderLine(),inputs));
        }
        return new Result(List.copyOf(matches),List.copyOf(notices));
    }
}
