package com.shinjin.pop.transfer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import synthetic.transfer.TransferDomain.StockKey;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Profile("demo")
@Component
public class TransferFormData {
    public record Site(String code, String name) {}
    public record Warehouse(String plant, String code, String name, String etc) {}
    public record Kind(String plant, String warehouse, String first, String second, String third, String name, String code2) {}
    public record Quality(String code, String name, String etc) {}
    public record Spec(String quality, String first, String second, String third,
                       BigDecimal thickness, BigDecimal width, BigDecimal length) {
        public Spec {
            thickness = normalize(thickness);
            width = normalize(width);
            length = normalize(length);
        }
        private static BigDecimal normalize(BigDecimal n) { return n == null ? null : n.stripTrailingZeros(); }
    }
    public record Material(String outPlant, String inPlant, String destination, Spec spec,
                           String source, String item, String part, String outEtc, String inEtc) {}
    public record Lot(String plant, String warehouse, String location, String lot, String item, Spec spec, int quantity) {}
    public record StockSearch(String plant, String warehouse, String quality, BigDecimal thickness, String location, String lot, String item) {}
    public record RequestStock(String outPlant, Spec spec, String warehouse, String item) {}
    public record Catalog(String description, List<Site> sites, List<Warehouse> warehouses,
                          List<Quality> qualities, List<Kind> kinds, List<Material> materials, List<Lot> lots, List<String> erpRequestNumbers,
                          List<StockSearch> stockSearches, List<RequestStock> requestStocks) {}

    final Catalog catalog;
    public TransferFormData(ObjectMapper mapper, @Value("${shinjin.demo.transfer-forms:}") String path) throws IOException {
        catalog = path.isBlank() ? null : mapper.readValue(Path.of(path).toFile(), Catalog.class);
    }
    Map<StockKey, BigDecimal> initialStock(Map<StockKey, BigDecimal> original) {
        var stock = new HashMap<>(original);
        if (catalog != null) for (Lot lot : catalog.lots()) {
            stock.merge(new StockKey(lot.warehouse(), lot.item()), BigDecimal.valueOf(lot.quantity()), BigDecimal::add);
        }
        return stock;
    }
    boolean hasWarehouse(String plant, String code) {
        return catalog.warehouses().stream().anyMatch(w -> w.plant().equals(plant) && w.code().equals(code) && !w.etc().isBlank());
    }
    Material resolve(String outPlant, String inPlant, String destination, Spec spec) {
        return catalog.materials().stream().filter(m -> Objects.equals(outPlant, m.outPlant())
                && Objects.equals(inPlant, m.inPlant()) && Objects.equals(destination, m.destination())
                && m.spec().equals(spec)).findFirst().orElse(null);
    }
}
