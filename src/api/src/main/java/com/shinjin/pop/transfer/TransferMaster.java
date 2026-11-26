package com.shinjin.pop.transfer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@Component
@Profile("demo")
public final class TransferMaster {
    public record Plant(String CODE_ID1, String CODE_ID2, String CODE_NAME_FULL, String ETC) {}
    public record Warehouse(String FACTORY_CODE, String PLANT_CODE, String WAREHOUSE_CODE,
                            String WAREHOUSE_NAME, String ETC, String DELETE_FLAG) {}
    public record ReportLine(String NO_GIREQ, int NO_LINE, String STND_ITEM, String DC_RMK) {}
    public record ReportHeader(String NO_GIREQ, String DC50_PO) {}
    public record DocumentNumber(String request, String kind, long revision, String NO_IO) {}
    public record Dataset(String description, List<Plant> TCO101, List<Warehouse> TCO102,
                          Map<String, String> terminalPlants, List<ReportLine> reportLines, List<ReportHeader> reportHeaders, List<DocumentNumber> documentNumbers) {}
    public record Options(boolean configured, String terminalPlant, List<Plant> plants, List<Warehouse> warehouses) {}

    private final Dataset data;
    private final boolean configured;

    public TransferMaster(ObjectMapper mapper, @Value("${shinjin.demo.transfer-master:}") String file) throws IOException {
        configured = !file.isBlank();
        data = !configured ? new Dataset("", List.of(), List.of(), Map.of(), List.of(), List.of(), List.of())
                : mapper.readValue(Path.of(file).toFile(), Dataset.class);
        if (data.TCO101() == null || data.TCO102() == null || data.terminalPlants() == null)
            throw new IllegalArgumentException("Missing transfer master tables or terminalPlants");
    }

    String documentNumber(synthetic.transfer.TransferDomain.DocumentId id) {
        if (data.documentNumbers() == null) return null;
        return data.documentNumbers().stream().filter(row -> id.request().equals(row.request())
                        && id.kind().name().equals(row.kind()) && id.revision() == row.revision())
                .map(DocumentNumber::NO_IO).filter(java.util.Objects::nonNull).findFirst().orElse(null);
    }

    String headerRemark(String request) {
        if (data.reportHeaders() == null) return null;
        return data.reportHeaders().stream().filter(row -> request.equals(row.NO_GIREQ()))
                .map(ReportHeader::DC50_PO).filter(java.util.Objects::nonNull).findFirst().orElse(null);
    }

    ReportLine reportLine(String request, int number) {
        if (data.reportLines() == null) return null;
        return data.reportLines().stream().filter(row -> request.equals(row.NO_GIREQ()) && row.NO_LINE() == number)
                .findFirst().orElse(null);
    }

    String plantName(String terminal, String warehouseCode) {
        var options = options(terminal);
        var codes = options.warehouses().stream().filter(w -> warehouseCode.equals(w.WAREHOUSE_CODE()))
                .map(Warehouse::PLANT_CODE).distinct().toList();
        if (codes.size() != 1) return null;
        return options.plants().stream().filter(p -> codes.get(0).equals(p.CODE_ID2()))
                .map(Plant::CODE_NAME_FULL).findFirst().orElse(null);
    }

    public Options options(String terminal) {
        var plants = data.TCO101().stream().filter(p -> "132".equals(p.CODE_ID1()))
                .sorted(Comparator.comparing(Plant::CODE_ID2)).toList();
        var warehouses = data.TCO102().stream().filter(w -> "000001".equals(w.FACTORY_CODE())
                && (w.DELETE_FLAG() == null || "0".equals(w.DELETE_FLAG()))
                && w.ETC() != null && !w.ETC().isEmpty())
                .sorted(Comparator.comparing(Warehouse::ETC)).toList();
        return new Options(configured, data.terminalPlants().get(terminal), plants, warehouses);
    }
}
