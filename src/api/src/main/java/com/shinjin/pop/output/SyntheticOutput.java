package com.shinjin.pop.output;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.oned.Code128Writer;
import com.google.zxing.qrcode.QRCodeWriter;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import com.google.zxing.WriterException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
@Profile("demo")
public final class SyntheticOutput {
    private static final float POINTS_PER_MM = 72f / 25.4f;
    private static final String INK = "#172832", ACCENT = "#005d66", MUTED = "#435966", RULE = "#b3c6cb";
    private static final Map<String, String> TITLES = Map.of(
            "Single", "단일 작업지시서", "Multiple", "묶음 작업지시서", "Multiple1", "품목 코드 작업지시서",
            "Multiple2", "거래처별 작업지시서", "Multiple3", "물류 작업지시서", "worker-code128", "작업자 바코드",
            "worker-qr", "작업자 QR", "packing-label", "포장 라벨", "outbound-list", "출고 목록", "shipment", "출하 문서");
    private final JsonNode data;
    private final String fontSetting;

    record Example(String id, int step, String label) {}
    record Group(List<String> key, List<String> rows, BigDecimal total) {}
    record Text(float x, float y, float size, String color, String text) {}
    record Block(float x, float y, float width, float height, String color) {}
    record PageView(float width, float height, List<Text> texts, List<Block> blocks) {}
    public record Contract(String status, int artifactCount, String documentRef, List<Integer> paperMm,
                    String deviceRole, String device, int pages, List<String> rows, List<Group> groups,
                    BigDecimal total, List<PageView> preview, int businessWrites, int virtualSubmissions,
                    int physicalSubmissions, int externalTransfers) {}
    public record Output(Contract contract, byte[] pdf) {}
    public record ShipmentDocument(String number, String packingRef, String lot, String item,
                                   BigDecimal quantity, boolean deferred, Instant confirmedAt) {}

    private record Row(String id, String customer, String material, String spec, BigDecimal quantity, String label) {}
    private record Symbol(String value, boolean qr) {}
    private record Section(List<Row> rows, Group group) {}
    private record Page(List<Section> sections, Symbol symbol, String description) {
        Page(List<Section> sections) { this(sections, null, ""); }
    }
    private record Document(String title, String reference, List<Integer> paper, String role,
                            List<Page> pages, BigDecimal total, List<Group> groups, boolean itemCodes) {}

    public SyntheticOutput(ObjectMapper mapper,
            @Value("${shinjin.demo.output-font:}") String fontSetting) throws IOException {
        try (var input = new ClassPathResource("synthetic-output-vectors.json").getInputStream()) {
            data = mapper.readTree(input);
        }
        this.fontSetting = fontSetting;
    }

    List<Example> examples() {
        var examples = new ArrayList<Example>();
        for (var item : data.path("pdf")) {
            var id = item.path("id").asString("");
            var title = TITLES.getOrDefault(item.path("form").asString(""), "미지원 양식");
            var steps = item.path("input").path("steps");
            for (int index = 0; index < Math.max(1, steps.size()); index++) {
                examples.add(new Example(id, index, id + " · " + title + (steps.isArray() ? " · " + (index + 1) : "")));
            }
        }
        return List.copyOf(examples);
    }

    Output render(String id, int step) {
        JsonNode item = null;
        for (var candidate : data.path("pdf")) {
            if (id.equals(candidate.path("id").asString(""))) { item = candidate; break; }
        }
        if (item == null || step < 0) return failure("EXAMPLE_NOT_FOUND");
        var spec = item.path("input");
        var steps = spec.path("steps");
        if (steps.isArray()) {
            if (step >= steps.size()) return failure("EXAMPLE_NOT_FOUND");
            spec = steps.get(step);
        } else if (step != 0) {
            return failure("EXAMPLE_NOT_FOUND");
        }

        final Document model;
        try {
            model = model(item.path("form").asString(""), spec);
        } catch (ContractFailure error) {
            return failure(error.getMessage());
        }
        if ("render-error".equals(spec.path("inject").asString(""))) return failure("RENDER_FAILED");
        return render(model);
    }

    public Output renderShipment(ShipmentDocument shipment) {
        var row = new Row(shipment.lot(), "원포장 " + shipment.packingRef(), shipment.item(),
                shipment.deferred() ? "이월" : "일반", shipment.quantity(),
                "품목 " + shipment.item() + " · 확정 " + shipment.confirmedAt());
        var page = new Page(List.of(new Section(List.of(row), null)));
        return render(new Document(TITLES.get("shipment"), shipment.number(), List.of(210, 297),
                "shipment", List.of(page), shipment.quantity(), List.of(), false));
    }

    private Output render(Document model) {
        if (fontSetting.isBlank()) return failure("FONT_NOT_CONFIGURED");
        var localFont = localFont(fontSetting);
        if (localFont == null) return failure("FONT_UNAVAILABLE");

        try (var pdf = new PDDocument(); var bytes = new ByteArrayOutputStream()) {
            final PDType0Font font;
            try (InputStream source = Files.newInputStream(localFont)) {
                font = PDType0Font.load(pdf, source);
            } catch (IOException | IllegalArgumentException error) {
                return failure("FONT_UNAVAILABLE");
            }
            var pages = layout(model, font);
            pdf.getDocumentInformation().setTitle(model.title());
            pdf.getDocumentInformation().setAuthor("Synthetic output");
            for (var view : pages) write(pdf, font, view);
            pdf.save(bytes);
            var rows = model.pages().stream().flatMap(page -> page.sections().stream())
                    .flatMap(section -> section.rows().stream()).map(Row::id).toList();
            return new Output(new Contract("PDF_READY", 1, model.reference(), model.paper(), model.role(),
                    data.path("devices").path(model.role()).asString(""), pages.size(), rows, model.groups(),
                    model.total(), pages, 0, 0, 0, 0), bytes.toByteArray());
        } catch (IOException | WriterException | IllegalArgumentException error) {
            return failure("RENDER_FAILED");
        }
    }

    private static Path localFont(String setting) {
        if (setting.startsWith("//") || setting.startsWith("\\\\") || setting.contains("://")) return null;
        try {
            var path = Path.of(setting).normalize();
            return path.isAbsolute() && Files.isRegularFile(path) && Files.isReadable(path) ? path : null;
        } catch (InvalidPathException | SecurityException error) {
            return null;
        }
    }

    private static Output failure(String status) {
        return new Output(new Contract(status, 0, null, List.of(), null, null, 0,
                List.of(), List.of(), null, List.of(), 0, 0, 0, 0), null);
    }

    private Document model(String form, JsonNode spec) {
        String title = TITLES.get(form);
        if (title == null) throw new ContractFailure("UNKNOWN_FORM");
        var fixtures = data.path("fixtures");
        var paper = List.of(210, 297);
        if (form.startsWith("worker-")) {
            var w = fixture(spec, fixtures, "worker");
            var id = field(spec, w, "id");
            var page = new Page(List.of(), new Symbol(id, form.equals("worker-qr")), field(spec, w, "name"));
            return new Document(title, "WORKER-" + id, paper, "document", List.of(page), null, List.of(), false);
        }
        if (form.equals("packing-label")) {
            var p = fixture(spec, fixtures, "pack");
            var qty = p.path("quantity").decimalValue();
            var page = new Page(List.of(), new Symbol(field(spec, p, "qr"), true), "포장 수량 " + amount(qty));
            return new Document(title, field(spec, p, "id"), List.of(100, 60), "label", List.of(page), qty, List.of(), false);
        }
        String role = "document";
        String reference;
        JsonNode ids = spec.path("rowIds");
        if (form.equals("outbound-list") || form.equals("shipment")) {
            boolean shipping = form.equals("shipment");
            var f = fixture(spec, fixtures, shipping ? "shipment" : "outbound");
            reference = field(spec, f, "id");
            ids = f.path("rowIds");
            if (shipping) role = "shipment";
        } else {
            reference = "WO-" + form + "-" + idString(ids);
        }
        var rows = rows(ids, fixtures.path("rows"));
        var groups = new ArrayList<Group>();
        var pages = new ArrayList<Page>();
        boolean itemCodes = form.equals("Multiple1");
        if (List.of("Multiple", "Multiple2", "Multiple3").contains(form)) {
            var byKey = new LinkedHashMap<List<String>, List<Row>>();
            for (var row : rows) {
                var key = form.equals("Multiple2") ? List.of(row.customer()) : List.of(row.customer(), row.material(), row.spec());
                byKey.computeIfAbsent(key, ignored -> new ArrayList<>()).add(row);
            }
            int groupsPerPage = spec.path("groupsPerPage").asInt(3);
            if (groupsPerPage < 1 || groupsPerPage > 8) throw new ContractFailure("INVALID_INPUT");
            var sections = new ArrayList<Section>();
            int used = 0;
            for (var entry : byKey.entrySet()) {
                var members = entry.getValue();
                var group = new Group(entry.getKey(), members.stream().map(Row::id).toList(), total(members));
                groups.add(group);
                for (int offset = 0; offset < members.size();) {
                    if (sections.size() == groupsPerPage || used >= 7) {
                        pages.add(new Page(List.copyOf(sections)));
                        sections.clear();
                        used = 0;
                    }
                    int end = Math.min(members.size(), offset + 7 - used);
                    sections.add(new Section(List.copyOf(members.subList(offset, end)), group));
                    used += end - offset + 1;
                    offset = end;
                }
            }
            if (!sections.isEmpty()) pages.add(new Page(List.copyOf(sections)));
        } else {
            int pageSize = spec.path("rowsPerPage").asInt(itemCodes ? 5 : 8);
            if (pageSize < 1 || pageSize > 8) throw new ContractFailure("INVALID_INPUT");
            for (int i = 0; i < rows.size(); i += pageSize) {
                pages.add(new Page(List.of(new Section(rows.subList(i, Math.min(i + pageSize, rows.size())), null))));
            }
        }
        return new Document(title, reference, paper, role, List.copyOf(pages), total(rows), List.copyOf(groups), itemCodes);
    }

    private static String idString(JsonNode ids) {
        var parts = new ArrayList<String>();
        ids.forEach(id -> parts.add(id.asString("")));
        try {
            var hash = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(hash.digest(String.join("\u001f", parts).getBytes(StandardCharsets.UTF_8)), 0, 6);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }

    private static List<Row> rows(JsonNode ids, JsonNode fixtures) {
        if (!ids.isArray()) throw new ContractFailure("INVALID_INPUT");
        if (ids.isEmpty()) throw new ContractFailure("EMPTY_SELECTION");
        var index = new LinkedHashMap<String, JsonNode>();
        for (var node : fixtures) index.put(node.path("id").asString(""), node);
        var rows = new ArrayList<Row>();
        for (var id : ids) {
            var row = index.remove(id.asString(""));
            if (row == null) throw new ContractFailure("INVALID_INPUT");
            rows.add(new Row(row.path("id").asString(""), row.path("customer").asString(""), row.path("material").asString(""),
                    row.path("spec").asString(""), row.path("quantity").decimalValue(), row.path("label").asString("")));
        }
        return List.copyOf(rows);
    }

    private static JsonNode fixture(JsonNode spec, JsonNode fixtures, String key) {
        if (!key.equals(spec.path("fixture").asString(""))) throw new ContractFailure("INVALID_INPUT");
        return fixtures.path(key);
    }

    private static String field(JsonNode spec, JsonNode fixture, String key) {
        for (var omit : spec.path("omit")) {
            if (key.equals(omit.asString(""))) throw new ContractFailure("INVALID_INPUT");
        }
        var value = fixture.path(key).asString("");
        if (value.isBlank()) throw new ContractFailure("INVALID_INPUT");
        return value;
    }

    private static BigDecimal total(List<Row> rows) {
        return rows.stream().map(Row::quantity).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String amount(BigDecimal number) { return number.stripTrailingZeros().toPlainString(); }

    private static List<PageView> layout(Document model, PDType0Font font) throws IOException, WriterException {
        var output = new ArrayList<PageView>();
        float width = model.paper().get(0) * POINTS_PER_MM, height = model.paper().get(1) * POINTS_PER_MM;
        boolean label = model.role().equals("label");
        float margin = label ? 17 : 34, right = width - margin, usable = right - margin;
        for (int index = 0; index < model.pages().size(); index++) {
            var page = model.pages().get(index);
            var texts = new ArrayList<Text>();
            var blocks = new ArrayList<Block>();
            blocks.add(new Block(margin, label ? 15 : 24, usable, 3, ACCENT));
            texts.add(new Text(margin, label ? 38 : 53, label ? 16 : 24, ACCENT, model.title()));
            texts.add(new Text(margin, label ? 53 : 73, label ? 8 : 10, INK, "합성 출력"));
            texts.add(new Text(margin, label ? 68 : 92, label ? 9 : 11, MUTED, model.reference()));
            if (page.symbol() != null) {
                texts.add(new Text(margin, label ? 99 : 136, label ? 11 : 13, INK, page.description()));
                texts.add(new Text(margin, label ? height - 18 : 320, label ? 8 : 11, MUTED, page.symbol().value()));
                symbol(blocks, page.symbol(), label ? right - 105 : margin, label ? 37 : 156,
                        label ? 105 : page.symbol().qr() ? 145 : 280, 58);
            } else {
                float y = 112;
                for (var section : page.sections()) {
                    if (section.group() != null) {
                        for (var part : wrap(font, String.join(" / ", section.group().key()) + " · 소계 "
                                + amount(section.group().total()), usable, 11)) {
                            texts.add(new Text(margin, y + 12, 11, ACCENT, part));
                            y += 15;
                        }
                        y += 5;
                    }
                    for (var row : section.rows()) {
                        blocks.add(new Block(margin, y, usable, .7f, RULE));
                        texts.add(new Text(margin, y + 14, 10, ACCENT, row.id()));
                        texts.add(new Text(right - 75, y + 14, 11, INK, "수량 " + amount(row.quantity())));
                        y += 16;
                        for (var part : wrap(font, row.label(), usable, 12)) {
                            texts.add(new Text(margin, y + 14, 12, INK, part));
                            y += 16;
                        }
                        for (var part : wrap(font, row.customer() + " / " + row.material() + " / " + row.spec(), usable, 9)) {
                            texts.add(new Text(margin, y + 11, 9, MUTED, part));
                            y += 13;
                        }
                        if (model.itemCodes()) {
                            symbol(blocks, new Symbol(row.id(), false), margin, y + 4, 170, 24);
                            y += 30;
                        }
                        y += 8;
                    }
                }
                if (y > height - 54) throw new IllegalArgumentException("Synthetic page exceeds layout");
            }
            if (!label) {
                blocks.add(new Block(margin, height - 42, usable, .7f, RULE));
                if (model.total() != null) texts.add(new Text(margin, height - 25, 10, INK, "문서 합계 " + amount(model.total())));
                texts.add(new Text(right - 65, height - 25, 10, MUTED, (index + 1) + " / " + model.pages().size()));
            }
            output.add(new PageView(width, height, List.copyOf(texts), List.copyOf(blocks)));
        }
        return List.copyOf(output);
    }

    private static List<String> wrap(PDType0Font font, String source, float width, int size) throws IOException {
        var lines = new ArrayList<String>();
        var line = new StringBuilder();
        float used = 0;
        for (int offset = 0; offset < source.length();) {
            int codePoint = source.codePointAt(offset);
            var part = new String(Character.toChars(codePoint));
            offset += part.length();
            float advance = font.getStringWidth(part) * size / 1000;
            if (used + advance > width && !line.isEmpty()) {
                lines.add(line.toString().stripTrailing());
                line.setLength(0);
                used = 0;
            }
            if (used == 0 && part.isBlank()) continue;
            line.append(part);
            used += advance;
        }
        if (!line.isEmpty()) lines.add(line.toString());
        return lines;
    }

    private static void symbol(List<Block> blocks, Symbol symbol, float x, float y, float width, float height) throws WriterException {
        if (symbol.qr()) {
            var matrix = new QRCodeWriter().encode(symbol.value(), BarcodeFormat.QR_CODE, 0, 0,
                    Map.of(EncodeHintType.MARGIN, 4));
            float size = width / matrix.getWidth();
            blocks.add(new Block(x, y, width, width, "#ffffff"));
            for (int row = 0; row < matrix.getHeight(); row++) {
                for (int col = 0; col < matrix.getWidth(); col++) {
                    if (matrix.get(col, row)) blocks.add(new Block(x + col * size, y + row * size, size, size, "#000000"));
                }
            }
        } else {
            var bits = new Code128Writer().encode(symbol.value());
            float unit = Math.min(width / (bits.length + 20), 2.3f);
            blocks.add(new Block(x, y, (bits.length + 20) * unit, height, "#ffffff"));
            for (int i = 0; i < bits.length;) {
                if (!bits[i]) { i++; continue; }
                int end = i + 1;
                while (end < bits.length && bits[end]) end++;
                blocks.add(new Block(x + (10 + i) * unit, y, (end - i) * unit, height, "#000000"));
                i = end;
            }
        }
    }

    private static void write(PDDocument pdf, PDType0Font font, PageView view) throws IOException {
        var page = new PDPage(new PDRectangle(view.width(), view.height()));
        pdf.addPage(page);
        try (var stream = new PDPageContentStream(pdf, page)) {
            for (var mark : view.blocks()) {
                stream.setNonStrokingColor(Color.decode(mark.color()));
                stream.addRect(mark.x(), view.height() - mark.y() - mark.height(), mark.width(), mark.height());
                stream.fill();
            }
            for (var mark : view.texts()) {
                stream.beginText();
                stream.setNonStrokingColor(Color.decode(mark.color()));
                stream.setFont(font, mark.size());
                stream.newLineAtOffset(mark.x(), view.height() - mark.y());
                stream.showText(mark.text());
                stream.endText();
            }
        }
    }

    private static final class ContractFailure extends IllegalArgumentException {
        ContractFailure(String code) { super(code); }
    }
}
