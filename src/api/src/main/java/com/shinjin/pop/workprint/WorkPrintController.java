package com.shinjin.pop.workprint;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import com.shinjin.pop.history.DemoSessionController.Identity;
import com.shinjin.pop.output.DemoReportPrinter;
import com.shinjin.pop.workprint.WorkPrintData.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import static com.shinjin.pop.workprint.WorkPrintData.reject;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/work-print")
public class WorkPrintController {
    record Options(String today,String center,List<List<String>> centers,List<List<String>> materials,List<Form> forms,boolean diagnostic) {}
    record PreviewRequest(UUID key, Form form, List<String> rows) {}
    record Document(UUID id,int pages,String device,List<String> groups,UUID submitKey) {}
    record Preview(PreviewRequest request,Document document,DemoReportPrinter.Preview print,WorkPrintRenderer.Rendered rendered) {}
    record Scan(String barcode) {}
    record Confirm(UUID token, boolean includeResults) {}
    record Ticket(UUID token,String number,boolean performance) {}
    record Submission(UUID key) {}
    record Receipt(UUID key,int rows,int pages,String device) {}
    static final class Window {
        String owner;
        Preview preview;
        final Set<UUID> opened=new HashSet<>();
        Receipt receipt;
        Ticket ticket;
        Removal removal;
        Confirm deleted;
    }
    private static final String WINDOW=WorkPrintController.class.getName();
    private final WorkPrintData data;
    private final WorkPrintRenderer renderer;
    private final TerminalSettingsDemoController settings;
    private final boolean diagnostic;
    private final Map<String,Integer> groupCounters=new HashMap<>();

    WorkPrintController(ObjectMapper mapper,WorkPrintRenderer renderer,TerminalSettingsDemoController settings,
            @Value("${shinjin.demo.work-print-data:classpath:demo/work-print.json}") Resource fixture,
            @Value("${shinjin.demo.work-print-submit:false}") boolean diagnostic) throws IOException {
        this.settings=settings;
        this.renderer=renderer;
        this.diagnostic=diagnostic;
        try(var stream=fixture.getInputStream()) {
            LocalDate day=LocalDate.now();
            String json=new String(stream.readAllBytes(),StandardCharsets.UTF_8)
                    .replace("$compactDay",day.format(DateTimeFormatter.BASIC_ISO_DATE))
                    .replace("$compactYesterday",day.minusDays(1).format(DateTimeFormatter.BASIC_ISO_DATE))
                    .replace("$today",day.toString()).replace("$yesterday",day.minusDays(1).toString());
            data=new WorkPrintData(mapper.readValue(json,Fixture.class));
        }
    }
    private static Identity identity(HttpServletRequest r) { return DemoSessionController.requireIdentity(r); }
    private Access access(Identity id) {
        return data.fixture.access().stream().filter(a->a.terminal().equals(id.terminal().id()) && a.worker().equals(id.worker().id()))
                .findFirst().orElseThrow(()->reject(HttpStatus.FORBIDDEN,"작업지시서 사용 권한이 없습니다."));
    }
    private Window window(HttpServletRequest r) {
        var session=r.getSession(false);
        var id=identity(r);
        String owner=id.terminal().id()+"/"+id.worker().id();
        var win=(Window)session.getAttribute(WINDOW);
        if (win==null || !owner.equals(win.owner)) {
            win=new Window(); win.owner=owner;session.setAttribute(WINDOW,win);
        }
        return win;
    }
    @ModelAttribute void guard(HttpServletRequest r,HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        access(identity(r));
    }
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> failure(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("message",Objects.toString(e.getReason(),"요청을 처리할 수 없습니다.")));
    }
    @GetMapping("/options") Options options(HttpServletRequest r) {
        var id=identity(r);
        return new Options(LocalDate.now().toString(),id.workCenterCode(),data.fixture.centers(),data.fixture.materials(),access(id).forms(),diagnostic);
    }
    @PostMapping("/search") synchronized List<GridRow> search(@RequestBody Filter f,HttpServletRequest r) {
        return data.search(identity(r).terminal().factory(),access(identity(r)).plant(),f);
    }
    private String device(HttpServletRequest r) {
        var view=settings.read(identity(r).terminal().id(),r).getBody();
        if (view==null || view.view()==null) return "";
        var v=view.view();String printer=v.applied().values().outputs().get("document");
        return printer!=null && v.catalog().printers().contains(printer) && !"NONE".equals(printer)?printer:"";
    }
    @PostMapping("/preview") synchronized Document preview(@RequestBody PreviewRequest input,HttpServletRequest r) {
        var id=identity(r);
        if(input.key()==null || input.form()==null)throw reject(HttpStatus.BAD_REQUEST,"양식을 확인하십시오.");
        if(!access(id).forms().contains(input.form()))throw reject(HttpStatus.FORBIDDEN,"이 양식의 사용 권한이 없습니다.");
        var win=window(r);
        if(win.preview!=null && win.preview.request().key().equals(input.key())) {
            if(!win.preview.request().equals(input))throw reject(HttpStatus.CONFLICT,"같은 요청의 선택 행이 변경되었습니다.");
            return win.preview.document();
        }
        if(win.opened.contains(input.key()))throw reject(HttpStatus.CONFLICT,"이미 닫힌 미리보기입니다.");
        String factory=id.terminal().factory();
        var rows=data.selected(factory,access(id).plant(),input.rows());
        // A nonempty SELECT2 leaves no SELECT3 table for the legacy closing check.
        if (input.form()==Form.Single && !"SINGLE_SELECT3".equals(rows.get(rows.size()-1).singleDivision()))
            throw reject(HttpStatus.UNPROCESSABLE_ENTITY,"단일 양식 조회 결과의 종결 여부를 확인할 수 없습니다.");
        boolean grouped=input.form()==Form.Multiple2 || input.form()==Form.Multiple3;
        String prefix="P"+LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        String scope=factory+"/"+prefix;
        int seq=groupCounters.getOrDefault(scope,0);
        List<Group> groups=new ArrayList<>(); List<GroupRow> pending=new ArrayList<>();
        for(var selected:data.grouped(input.form(),rows).values()) {
            String number=grouped ? prefix+String.format(Locale.ROOT,"%06d",++seq) : "";
            var detailRows=new ArrayList<Map<String,String>>();
            Comparator<Order> dimensions=Comparator.comparing((Order o)->new java.math.BigDecimal(o.field("THICKNESS")))
                    .thenComparing(o->new java.math.BigDecimal(o.field("SPEC_X")));
            var ordered=switch(input.form()) {
                case Single -> selected;
                case Multiple, Multiple1 -> selected.stream().sorted(dimensions
                        .thenComparing(o->new java.math.BigDecimal(o.field("SPEC_Y")))).toList();
                case Multiple2, Multiple3 -> selected.stream().sorted(Comparator
                        .comparing((Order o)->o.field("MAT_QUALITY_NAME"),Comparator.reverseOrder())
                        .thenComparing(dimensions)).toList();
            };
            for (var o:ordered) {
                var detail=new LinkedHashMap<>(o.report());
                if (input.form()!=Form.Single) detail.put("No",Integer.toString(detailRows.size()+1));
                detailRows.add(detail);
            }
            groups.add(new Group(number,Map.copyOf(selected.get(0).report()),detailRows));
            if(grouped)for(var o:selected)pending.add(new GroupRow(factory,number,o.key(),id.worker().id()));
        }
        var rendered=renderer.render(input.form(),groups);
        var print=new DemoReportPrinter(call->{throw new IllegalStateException();}).openPreview(
                new DemoReportPrinter.Devices(device(r),null),DemoReportPrinter.ManualForm.WORK_ORDER,rendered.pages().size());
        var doc=new Document(UUID.randomUUID(),rendered.pages().size(),print.device(),groups.stream().map(Group::number).filter(n->!n.isEmpty()).toList(),UUID.randomUUID());
        if(grouped)groupCounters.put(scope,seq);
        data.groupRows.addAll(pending);
        win.opened.add(input.key());
        win.preview=new Preview(input,doc,print,rendered);win.receipt=null;
        return doc;
    }
    private Preview active(Window win,UUID id) {
        if(win.preview==null || !win.preview.document().id().equals(id))throw reject(HttpStatus.NOT_FOUND,"미리보기가 만료되었습니다.");
        return win.preview;
    }
    @GetMapping(value="/preview/{id}/{page}",produces="image/png")
    synchronized byte[] page(@PathVariable UUID id,@PathVariable int page,HttpServletRequest r) {
        var p=active(window(r),id);
        if(page<1 || page>p.rendered().pages().size())throw reject(HttpStatus.NOT_FOUND,"페이지를 찾을 수 없습니다.");
        return p.rendered().pages().get(page-1);
    }
    @GetMapping(value="/preview/{id}/pdf",produces=MediaType.APPLICATION_PDF_VALUE)
    synchronized ResponseEntity<byte[]> pdf(@PathVariable UUID id,HttpServletRequest r) {
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"inline; filename=work-order.pdf")
                .contentType(MediaType.APPLICATION_PDF).body(active(window(r),id).rendered().pdf());
    }
    @PostMapping("/preview/{id}/close") synchronized Map<String,Boolean> close(@PathVariable UUID id,HttpServletRequest r) {
        var win=window(r);
        if(win.preview!=null && win.preview.document().id().equals(id)) { win.preview=null;win.receipt=null; }
        return Map.of("closed",true);
    }
    @PostMapping("/preview/{id}/submit") synchronized Receipt submit(@PathVariable UUID id,@RequestBody Submission input,HttpServletRequest r) {
        if(!diagnostic)throw reject(HttpStatus.FORBIDDEN,"합성 제출 모드가 꺼져 있습니다.");
        var win=window(r);var p=active(win,id);var who=identity(r);
        if(!p.document().submitKey().equals(input.key()))throw reject(HttpStatus.CONFLICT,"제출 키를 확인하십시오.");
        if(win.receipt!=null)return win.receipt;
        var rows=data.selected(who.terminal().factory(),access(who).plant(),p.request().rows());
        if(device(r).isEmpty() || !device(r).equals(p.print().device()))throw reject(HttpStatus.UNPROCESSABLE_ENTITY,"문서 프린터가 설정되지 않았습니다.");
        new DemoReportPrinter(call->{
            for(var o:rows) {
                o.grid().put("PRINT_CNT",String.valueOf(o.number("PRINT_CNT")+1));
                o.grid().put("BASE_NAME",who.worker().name());
                data.erpStatus.put(o.field("OLD_ORDER_NO")+"/"+o.field("OLD_ORDER_SEQNO"),"350");
            }
            win.receipt=new Receipt(input.key(),rows.size(),call.documentPages(),call.device());
        }).printFromPreview(p.print(),OptionalInt.empty());
        return win.receipt;
    }
    @PostMapping("/delete/scan") synchronized Ticket scan(@RequestBody Scan input,HttpServletRequest r) {
        var removal=data.scan(identity(r).terminal().factory(),access(identity(r)).plant(),input.barcode());var win=window(r);
        win.removal=removal;win.ticket=new Ticket(UUID.randomUUID(),removal.number(),removal.performance());
        win.deleted=null;return win.ticket;
    }
    @PostMapping("/delete/confirm") synchronized Map<String,String> delete(@RequestBody Confirm input,HttpServletRequest r) {
        var win=window(r);
        if(win.ticket==null || !win.ticket.token().equals(input.token()))throw reject(HttpStatus.CONFLICT,"수주번호를 다시 확인하십시오.");
        if(!input.equals(win.deleted)) {
            var current=data.scan(identity(r).terminal().factory(),access(identity(r)).plant(),win.ticket.number());
            if(!current.equals(win.removal) || current.performance()!=input.includeResults())
                throw reject(HttpStatus.CONFLICT,"생산실적 삭제 확인이 필요합니다.");
            data.links.removeAll(current.links());current.keys().forEach(data.orders::remove);win.deleted=input;
        }
        return Map.of("number",win.ticket.number());
    }
}